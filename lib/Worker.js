// lib/Worker.js
const debug = require('debug')('SubtitleGenerator:Worker');
const PgBoss = require('pg-boss');
const fs = require('fs');
const path = require('path');

// Cache variant for primary transcriptions: Whisper + automatic name
// correction. Bump the suffix whenever the pipeline's output changes so stale
// cached results aren't served.
const PRIMARY_VARIANT = 'transcribe:auto1';

class Worker {
  constructor(handler) {
    this.handler = handler;
    this.boss = null;
  }

  async init() {
    // Create pg-boss instance using the same DB connection string
    const connectionString = process.env.DATABASE_URL ||
      `postgresql://${process.env.PG_USER}:${process.env.PG_PASSWORD}@${process.env.PG_HOST}:${process.env.PG_PORT || 5432}/${process.env.PG_DATABASE}`;

    this.boss = new PgBoss(connectionString);

    this.boss.on('error', (error) => {
      debug('pg-boss error:', error);
    });

    await this.boss.start();
    debug('Worker started, listening for jobs');

    // Register job handler
    await this.boss.work('transcribe_job', { teamSize: 2, teamConcurrency: 4 },
      (job) => this._processJob(job));
  }

  /**
   * Enqueue a transcription job for background processing.
   * @param {string} jobId - UUID of the job record in the jobs table
   * @param {object} data - Additional data to attach to the pg-boss job
   * @returns {Promise<string>} The pg-boss job ID
   */
  async enqueue(jobId, data) {
    const id = await this.boss.send('transcribe_job', { jobId, ...data });
    debug(`Enqueued job ${jobId} as pg-boss job ${id}`);
    return id;
  }

  /**
   * Process a transcription job.
   * Transcribes the uploaded audio via Whisper (chunked for long files),
   * applies optional name correction and translations, caches results, then
   * debits credits and marks the job succeeded in one transaction.
   * @param {object} pgBossJob - pg-boss job object
   */
  async _processJob(pgBossJob) {
    const { jobId } = pgBossJob.data;
    debug(`Processing job ${jobId}`);

    const { jobs, mediaCache, r2, credits, postgres } = this.handler;
    const transcriber = this.handler.transcriber;
    const subtitleWriter = this.handler.subtitleWriter;
    const translator = this.handler.translator;
    const corrector = this.handler.corrector;

    // Atomic queued -> running. A duplicate delivery finds the job already
    // claimed and must not touch it (or its temp audio).
    const job = await jobs.claim(jobId);
    if (!job) {
      debug(`Job ${jobId} is not queued (duplicate delivery or already finished); skipping`);
      return;
    }

    const audioPath = path.join(__dirname, '..', 'tmp', 'audio', `${jobId}.mp3`);

    try {
      const { audio_sha256, language, additional_languages, audio_seconds, user_id } = job;
      const primaryVariant = PRIMARY_VARIANT;

      // Check cache for primary language. A hit is only usable with its
      // transcript, which translations are built from.
      const cached = await mediaCache.lookup(audio_sha256, language, primaryVariant);
      const cacheHit = !!(cached && cached.subtitle_srt_key && cached.transcript_key);

      let segments;
      // What the audio is (from name correction); feeds the translation glossary.
      let media = {};

      if (cacheHit) {
        debug(`Cache hit for ${audio_sha256}/${language}/${primaryVariant}`);

        const transcriptBuffer = await r2.downloadBuffer(cached.transcript_key);
        const transcript = JSON.parse(transcriptBuffer.toString());
        segments = transcript.segments;
        media = transcript.media || {};

        await jobs.updateStatus(jobId, 'running', { cached_hit: true });
        await this._recordSubtitles(jobId, language, cached.subtitle_srt_key, cached.subtitle_vtt_key);
      } else {
        debug(`Cache miss for ${audio_sha256}/${language}/${primaryVariant}, transcribing...`);

        await jobs.setStage(jobId, 'transcribing');
        const transcription = await transcriber.transcribeFile(audioPath, {
          language,
          onChunk: (index, total) => {
            if (total > 1) jobs.setStage(jobId, `transcribing:${index + 1}/${total}`).catch(() => {});
          }
        });
        segments = transcription.segments;

        // Fix misheard names. The corrector identifies the show/film itself
        // from the file name, embedded title, and transcript.
        await jobs.setStage(jobId, 'correcting');
        const correction = await corrector.correctSegments(segments, {
          fileName: job.source_name,
          mediaTitle: job.media_title
        });
        segments = correction.segments;
        if (correction.identification && correction.identification.identified && correction.identification.confidence !== 'low') {
          media = { title: correction.identification.title, names: correction.names };
        }

        const transcriptJson = JSON.stringify({
          segments,
          text: transcription.text,
          language: transcription.language,
          duration: transcription.duration,
          media
        });
        const transcriptKey = r2.transcriptKey(audio_sha256, primaryVariant, language);
        const { srtKey, vttKey } = await this._uploadSubtitles(
          audio_sha256, primaryVariant, language, segments,
          [r2.uploadBuffer(transcriptKey, Buffer.from(transcriptJson), 'application/json')]
        );

        await mediaCache.upsert(audio_sha256, language, primaryVariant, {
          subtitle_srt_key: srtKey,
          subtitle_vtt_key: vttKey,
          transcript_key: transcriptKey
        });
        await this._recordSubtitles(jobId, language, srtKey, vttKey);
      }

      // Process additional languages (translations). Cached per source
      // transcript variant, so a translation is never served as a primary
      // transcription and context-corrected sources stay separate.
      const translationVariant = `translate:${language}:${primaryVariant}`;
      const translated = [];

      for (const targetLang of additional_languages || []) {
        const langCached = await mediaCache.lookup(audio_sha256, targetLang, translationVariant);

        if (langCached && langCached.subtitle_srt_key) {
          debug(`Cache hit for translation ${targetLang}`);
          await this._recordSubtitles(jobId, targetLang, langCached.subtitle_srt_key, langCached.subtitle_vtt_key);
          translated.push(targetLang);
          continue;
        }

        debug(`Translating to ${targetLang}...`);
        await jobs.setStage(jobId, `translating:${targetLang}`);
        const translatedSegments = await translator.translateSegments(segments, targetLang, language, media);

        const { srtKey, vttKey } = await this._uploadSubtitles(
          audio_sha256, translationVariant, targetLang, translatedSegments
        );

        await mediaCache.upsert(audio_sha256, targetLang, translationVariant, {
          subtitle_srt_key: srtKey,
          subtitle_vtt_key: vttKey
        });
        await this._recordSubtitles(jobId, targetLang, srtKey, vttKey);
        translated.push(targetLang);
      }

      // Charge for what was delivered, on the server-measured duration, and
      // mark success atomically: either both happen or neither does.
      await jobs.setStage(jobId, 'finalizing');
      const totalMinutes = credits.calculateJobCost(audio_seconds, translated.length);

      const succeeded = await postgres.withTransaction(async (client) => {
        if (media.title) {
          await client.query('UPDATE jobs SET detected_title = $1 WHERE id = $2', [media.title, jobId]);
        }
        const done = await jobs.markSucceeded(jobId, totalMinutes, cacheHit, client);
        if (!done) return null;
        await credits.debitJob(user_id, jobId, totalMinutes, client);
        return done;
      });

      if (!succeeded) {
        debug(`Job ${jobId} was no longer running at finalize (expired?); not charged`);
        return;
      }
      jobs.publishStatus(jobId, 'succeeded');

      debug(`Job ${jobId} completed, charged ${totalMinutes} minutes`);

    } catch (error) {
      debug(`Job ${jobId} failed:`, error);
      await jobs.markFailed(jobId, 'PROCESSING_ERROR', error.message);
      // Not rethrown: the job row is terminal and the temp audio is gone, so a
      // pg-boss retry could only fail again.
    } finally {
      fs.rm(audioPath, { force: true }, (err) => {
        if (!err) debug(`Cleaned up temp audio for job ${jobId}`);
      });
    }
  }

  /**
   * Render segments to SRT + VTT and upload both (plus any extra uploads).
   * @returns {Promise<{srtKey: string, vttKey: string}>}
   */
  async _uploadSubtitles(audioSha256, variant, language, segments, extraUploads = []) {
    const { r2, subtitleWriter } = this.handler;
    const srtKey = r2.subtitleKey(audioSha256, variant, language, 'srt');
    const vttKey = r2.subtitleKey(audioSha256, variant, language, 'vtt');

    await Promise.all([
      r2.uploadBuffer(srtKey, Buffer.from(subtitleWriter.generateSRTString(segments)), 'text/plain'),
      r2.uploadBuffer(vttKey, Buffer.from(subtitleWriter.generateVTTString(segments)), 'text/vtt'),
      ...extraUploads
    ]);

    return { srtKey, vttKey };
  }

  /**
   * Attach a language's SRT + VTT objects to a job (idempotent).
   */
  async _recordSubtitles(jobId, language, srtKey, vttKey) {
    await this.handler.postgres.query(
      `INSERT INTO subtitles (job_id, language, format, object_key) VALUES ($1, $2, 'srt', $3), ($1, $2, 'vtt', $4)
       ON CONFLICT (job_id, language, format) DO NOTHING`,
      [jobId, language, srtKey, vttKey]
    );
  }

  /**
   * Gracefully stop the worker and pg-boss instance.
   */
  async stop() {
    if (this.boss) {
      await this.boss.stop();
      debug('Worker stopped');
    }
  }
}

module.exports = Worker;
