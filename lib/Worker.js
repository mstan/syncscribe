// lib/Worker.js
const debug = require('debug')('SubtitleGenerator:Worker');
const PgBoss = require('pg-boss');

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
   * Downloads audio from R2, transcribes via Whisper, generates subtitles,
   * handles translations, caches results, and charges credits.
   * @param {object} pgBossJob - pg-boss job object
   */
  async _processJob(pgBossJob) {
    const { jobId } = pgBossJob.data;
    debug(`Processing job ${jobId}`);

    const { jobs, mediaCache, r2, credits } = this.handler;
    const transcriber = this.handler.transcriber;
    const subtitleWriter = this.handler.subtitleWriter;
    const translator = this.handler.translator;

    try {
      // Update status to running
      await jobs.updateStatus(jobId, 'running');
      const job = await jobs.getById(jobId);

      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }

      const { audio_sha256, language, additional_languages, audio_seconds, user_id } = job;

      // Check cache for primary language
      const cached = await mediaCache.lookup(audio_sha256, language, job.mode);

      let segments;

      if (cached && cached.subtitle_srt_key) {
        debug(`Cache hit for ${audio_sha256}/${language}`);

        // Download cached transcript to get segments for translations
        if (cached.transcript_key) {
          const transcriptBuffer = await r2.downloadBuffer(cached.transcript_key);
          const transcript = JSON.parse(transcriptBuffer.toString());
          segments = transcript.segments;
        }

        // Mark cache hit
        await jobs.updateStatus(jobId, 'running', { cached_hit: true });

        // Create subtitle records for cached primary language
        await this.handler.postgres.query(
          `INSERT INTO subtitles (job_id, language, format, object_key) VALUES ($1, $2, 'srt', $3), ($1, $2, 'vtt', $4)
           ON CONFLICT DO NOTHING`,
          [jobId, language, cached.subtitle_srt_key, cached.subtitle_vtt_key]
        );
      } else {
        debug(`Cache miss for ${audio_sha256}/${language}, transcribing...`);

        // Read audio from temp file
        const fs = require('fs');
        const path = require('path');
        const audioPath = path.join(__dirname, '..', 'tmp', 'audio', `${jobId}.mp3`);
        const audioBuffer = fs.readFileSync(audioPath);

        // Transcribe
        const transcription = await transcriber.transcribeBuffer(audioBuffer, { language });
        segments = transcription.segments;

        // Generate SRT and VTT strings
        const srtContent = subtitleWriter.generateSRTString(segments);
        const vttContent = subtitleWriter.generateVTTString(segments);
        const transcriptJson = JSON.stringify({
          segments,
          text: transcription.text,
          language: transcription.language,
          duration: transcription.duration
        });

        // Upload to R2
        const srtKey = r2.subtitleKey(audio_sha256, language, 'srt');
        const vttKey = r2.subtitleKey(audio_sha256, language, 'vtt');
        const transcriptKey = r2.transcriptKey(audio_sha256, language);

        await Promise.all([
          r2.uploadBuffer(srtKey, Buffer.from(srtContent), 'text/plain'),
          r2.uploadBuffer(vttKey, Buffer.from(vttContent), 'text/vtt'),
          r2.uploadBuffer(transcriptKey, Buffer.from(transcriptJson), 'application/json')
        ]);

        // Upsert cache
        await mediaCache.upsert(audio_sha256, language, job.mode, {
          subtitle_srt_key: srtKey,
          subtitle_vtt_key: vttKey,
          transcript_key: transcriptKey
        });

        // Create subtitle records
        await this.handler.postgres.query(
          `INSERT INTO subtitles (job_id, language, format, object_key) VALUES ($1, $2, 'srt', $3), ($1, $2, 'vtt', $4)`,
          [jobId, language, srtKey, vttKey]
        );
      }

      // Process additional languages (translations)
      if (additional_languages && additional_languages.length > 0 && segments) {
        for (const targetLang of additional_languages) {
          // Check cache for this language
          const langCached = await mediaCache.lookup(audio_sha256, targetLang, job.mode);

          if (langCached && langCached.subtitle_srt_key) {
            debug(`Cache hit for translation ${targetLang}`);
            await this.handler.postgres.query(
              `INSERT INTO subtitles (job_id, language, format, object_key) VALUES ($1, $2, 'srt', $3), ($1, $2, 'vtt', $4)
               ON CONFLICT DO NOTHING`,
              [jobId, targetLang, langCached.subtitle_srt_key, langCached.subtitle_vtt_key]
            );
            continue;
          }

          debug(`Translating to ${targetLang}...`);
          const translatedSegments = await translator.translateSegments(segments, targetLang, language);

          const srtContent = subtitleWriter.generateSRTString(translatedSegments);
          const vttContent = subtitleWriter.generateVTTString(translatedSegments);

          const srtKey = r2.subtitleKey(audio_sha256, targetLang, 'srt');
          const vttKey = r2.subtitleKey(audio_sha256, targetLang, 'vtt');

          await Promise.all([
            r2.uploadBuffer(srtKey, Buffer.from(srtContent), 'text/plain'),
            r2.uploadBuffer(vttKey, Buffer.from(vttContent), 'text/vtt')
          ]);

          await mediaCache.upsert(audio_sha256, targetLang, job.mode, {
            subtitle_srt_key: srtKey,
            subtitle_vtt_key: vttKey
          });

          await this.handler.postgres.query(
            `INSERT INTO subtitles (job_id, language, format, object_key) VALUES ($1, $2, 'srt', $3), ($1, $2, 'vtt', $4)`,
            [jobId, targetLang, srtKey, vttKey]
          );
        }
      }

      // Calculate cost and charge credits
      const additionalCount = (additional_languages || []).length;
      const totalMinutes = credits.calculateJobCost(audio_seconds, additionalCount);

      await credits.debitJob(user_id, jobId, totalMinutes);
      await jobs.markSucceeded(jobId, totalMinutes, !!cached);

      debug(`Job ${jobId} completed, charged ${totalMinutes} minutes`);

    } catch (error) {
      debug(`Job ${jobId} failed:`, error);
      await jobs.markFailed(jobId, 'PROCESSING_ERROR', error.message);
      throw error; // pg-boss will handle retry
    } finally {
      // Clean up temp audio file
      try {
        const fs = require('fs');
        const path = require('path');
        const audioPath = path.join(__dirname, '..', 'tmp', 'audio', `${jobId}.mp3`);
        fs.unlinkSync(audioPath);
        debug(`Cleaned up temp audio for job ${jobId}`);
      } catch {}
    }
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
