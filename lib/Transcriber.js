// lib/Transcriber.js
const debug = require('debug')('SubtitleGenerator:Transcriber');
const OpenAI = require('openai');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

const execFileAsync = promisify(execFile);

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const GROQ_DEFAULT_MODEL = 'whisper-large-v3';
const OPENAI_DEFAULT_MODEL = 'whisper-1';

// Whisper rejects uploads over 25 MB. Audio above SINGLE_REQUEST_MAX_BYTES is
// split into chunks of roughly CHUNK_TARGET_BYTES, leaving headroom for
// container overhead and bitrate variation within a chunk.
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;
const SINGLE_REQUEST_MAX_BYTES = 24 * 1024 * 1024;
const CHUNK_TARGET_BYTES = 20 * 1024 * 1024;
// Trailing text of the previous chunk passed as Whisper's `prompt` so names
// and style stay consistent across chunk boundaries.
const PROMPT_CARRY_CHARS = 200;

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

function isRetryable(error) {
  const status = error.status || error.statusCode;
  return status === 429 || (status >= 500 && status < 600);
}

async function withRetry(fn, label) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < MAX_RETRIES && isRetryable(error)) {
        const delay = RETRY_DELAYS[attempt];
        debug(`${label} failed (${error.status}), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
}

class Transcriber {
  constructor(handler) {
    this.handler = handler;
    this.client = null;
    this.providers = [];
    this.model = null;
    this.provider = null;
    // Instance-level so tests can exercise chunking with small files.
    this.singleRequestMaxBytes = SINGLE_REQUEST_MAX_BYTES;
    this.chunkTargetBytes = CHUNK_TARGET_BYTES;
  }

  async init() {
    // Ordered transcription providers; each request falls through to the next
    // one when the previous fails after its retries. Default order puts OpenAI
    // whisper-1 first with Groq-hosted whisper-large-v3 (same API shape,
    // segment timestamps) as the fallback. whisper-1 shuts down 2027-02-26 and
    // its OpenAI replacements return no timestamps; flip the order with
    // TRANSCRIBE_PROVIDERS=groq,openai once Groq is the primary.
    const available = {
      openai: process.env.OPENAI_API_KEY && {
        name: 'openai',
        client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
        model: process.env.OPENAI_TRANSCRIBE_MODEL || OPENAI_DEFAULT_MODEL
      },
      groq: process.env.GROQ_API_KEY && {
        name: 'groq',
        client: new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: GROQ_BASE_URL }),
        model: process.env.GROQ_TRANSCRIBE_MODEL || GROQ_DEFAULT_MODEL
      }
    };
    const order = (process.env.TRANSCRIBE_PROVIDERS || 'openai,groq').split(',').map(n => n.trim());
    this.providers = order.map(name => available[name]).filter(Boolean);

    if (this.providers.length === 0) {
      throw new Error(
        'No transcription API key: set OPENAI_API_KEY and/or GROQ_API_KEY ' +
        'in your .env file or environment.'
      );
    }

    // Primary provider, used by the single-file CLI path and recorded on jobs.
    this.client = this.providers[0].client;
    this.model = this.providers[0].model;
    this.provider = this.providers[0].name;

    debug('Transcriber initialized: %s', this.providers.map(pr => `${pr.name}/${pr.model}`).join(' -> '));
  }

  /**
   * Transcribe audio file using OpenAI Whisper API
   * @param {string} audioPath - Path to audio file
   * @param {Object} options - Transcription options
   * @param {string} options.language - Language code (e.g., 'en', 'ja')
   * @returns {Promise<Object>} Transcription result with segments
   */
  async transcribe(audioPath, options = {}) {
    const { language } = options;

    debug(`Transcribing audio: ${audioPath}`);
    debug(`Options: language=${language}`);

    // Check file size (Whisper has 25MB limit)
    const stats = await fs.stat(audioPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    debug(`Audio file size: ${fileSizeMB.toFixed(2)} MB`);

    if (fileSizeMB > 25) {
      throw new Error(
        `Audio file is ${fileSizeMB.toFixed(2)} MB, which exceeds Whisper's 25 MB limit. ` +
        'Consider using a shorter video or compressing the audio.'
      );
    }

    try {
      const transcription = await withRetry(() =>
        this.client.audio.transcriptions.create({
          file: fs.createReadStream(audioPath),
          model: this.model,
          response_format: 'verbose_json',
          language: language ? this._convertToWhisperLanguageCode(language) : undefined,
          timestamp_granularities: ['word', 'segment']
        }),
        'Whisper transcription'
      );

      debug(`Transcription completed: ${transcription.segments?.length || 0} segments`);

      const segments = this._processSegments(transcription);

      return {
        text: transcription.text,
        language: transcription.language,
        duration: transcription.duration,
        segments: segments,
        raw: transcription
      };

    } catch (error) {
      debug('Transcription error:', error);

      if (error.status === 401) {
        throw new Error(`${this.provider} transcription API authentication failed. Please check your ${this.provider === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY'}.`);
      }

      if (error.status === 429) {
        throw new Error(`${this.provider} transcription rate limit exceeded after retries. Please try again later.`);
      }

      throw new Error(`Transcription failed: ${error.message}`);
    }
  }

  /**
   * Transcribe audio from a Buffer (for web uploads, no file path needed)
   * @param {Buffer} audioBuffer - Audio data buffer
   * @param {Object} options - Transcription options
   * @param {string} options.language - Language code
   * @param {string} [options.filename='audio.mp3'] - Filename for the API
   * @param {string} [options.prompt] - Preceding text to condition Whisper on
   * @returns {Promise<Object>} Transcription result with segments
   */
  async transcribeBuffer(audioBuffer, options = {}) {
    const { language, filename = 'audio.mp3', prompt } = options;

    debug(`Transcribing buffer: ${(audioBuffer.length / (1024 * 1024)).toFixed(2)} MB`);

    if (audioBuffer.length > WHISPER_MAX_BYTES) {
      throw new Error(
        `Audio buffer is ${(audioBuffer.length / (1024 * 1024)).toFixed(2)} MB, which exceeds Whisper's 25 MB limit.`
      );
    }

    let transcription;
    let lastError;
    for (const provider of this.providers) {
      try {
        transcription = await withRetry(async () => {
          const file = await OpenAI.toFile(audioBuffer, filename);
          return provider.client.audio.transcriptions.create({
            file: file,
            model: provider.model,
            response_format: 'verbose_json',
            language: language ? this._convertToWhisperLanguageCode(language) : undefined,
            prompt: prompt || undefined,
            timestamp_granularities: ['word', 'segment']
          });
        }, `${provider.name} transcription`);
        debug(`Buffer transcription completed via ${provider.name}/${provider.model}: ${transcription.segments?.length || 0} segments`);
        break;
      } catch (error) {
        lastError = error;
        debug(`${provider.name} transcription failed (${error.status || 'no status'}): ${error.message}`);
      }
    }

    if (!transcription) {
      if (lastError && lastError.status === 429) {
        throw new Error('Transcription rate limit exceeded on every provider. Please try again later.');
      }
      throw new Error(`Transcription failed: ${lastError ? lastError.message : 'no provider available'}`);
    }

    const segments = this._processSegments(transcription);

    return {
      text: transcription.text,
      language: transcription.language,
      duration: transcription.duration,
      segments: segments,
      raw: transcription
    };
  }

  /**
   * Measure an audio file's duration with ffprobe.
   * @param {string} audioPath - Path to the audio file
   * @returns {Promise<number>} Duration in seconds (fractional)
   */
  async probeDuration(audioPath) {
    const { stdout } = await execFileAsync(ffprobeStatic.path, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath
    ]);
    const seconds = parseFloat(stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error(`Could not determine audio duration (ffprobe output: ${stdout.trim() || 'empty'})`);
    }
    return seconds;
  }

  /**
   * Transcribe an audio file of any length. Files within Whisper's upload
   * limit go in one request; longer files are split into chunks (stream copy,
   * no re-encode), transcribed in order, and stitched back together with
   * timestamps offset by each chunk's start time.
   * @param {string} audioPath - Path to the audio file
   * @param {Object} options
   * @param {string} options.language - Language code (or 'auto')
   * @param {function(number, number)} [options.onChunk] - Called with (index, total) before each chunk
   * @returns {Promise<Object>} { text, language, duration, segments }
   */
  async transcribeFile(audioPath, options = {}) {
    const { language, onChunk } = options;
    const { size } = await fs.stat(audioPath);

    if (size <= this.singleRequestMaxBytes) {
      return this.transcribeBuffer(await fs.readFile(audioPath), { language, filename: path.basename(audioPath) });
    }

    const totalSeconds = await this.probeDuration(audioPath);
    const chunkSeconds = Math.max(10, Math.floor(totalSeconds * (this.chunkTargetBytes / size)));
    const ext = path.extname(audioPath) || '.mp3';
    const chunkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncscribe-chunks-'));

    debug(`Splitting ${(size / (1024 * 1024)).toFixed(2)} MB / ${totalSeconds.toFixed(0)}s audio into ~${chunkSeconds}s chunks`);

    try {
      await execFileAsync(ffmpegStatic, [
        '-v', 'error',
        '-i', audioPath,
        '-f', 'segment',
        '-segment_time', String(chunkSeconds),
        '-reset_timestamps', '1',
        '-c', 'copy',
        path.join(chunkDir, `chunk_%04d${ext}`)
      ]);

      const chunkFiles = (await fs.readdir(chunkDir)).filter(f => f.startsWith('chunk_')).sort();
      if (chunkFiles.length === 0) {
        throw new Error('Audio splitting produced no chunks');
      }

      const segments = [];
      const texts = [];
      let offset = 0;
      let detectedLanguage;

      for (let i = 0; i < chunkFiles.length; i++) {
        const chunkPath = path.join(chunkDir, chunkFiles[i]);
        const chunkBuffer = await fs.readFile(chunkPath);
        if (chunkBuffer.length > WHISPER_MAX_BYTES) {
          throw new Error(`Audio chunk ${i + 1} is ${(chunkBuffer.length / (1024 * 1024)).toFixed(2)} MB, over Whisper's 25 MB limit`);
        }
        const chunkDuration = await this.probeDuration(chunkPath);
        if (onChunk) onChunk(i, chunkFiles.length);

        const prompt = texts.length > 0 ? texts[texts.length - 1].slice(-PROMPT_CARRY_CHARS) : undefined;
        const result = await this.transcribeBuffer(chunkBuffer, { language, filename: chunkFiles[i], prompt });
        detectedLanguage = detectedLanguage || result.language;

        for (const seg of result.segments) {
          // Whisper's fallback segment for an empty chunk has no speech; skip it.
          if (!seg.text) continue;
          segments.push({
            ...seg,
            id: segments.length + 1,
            start: Math.min(seg.start, chunkDuration) + offset,
            end: Math.min(seg.end, chunkDuration) + offset
          });
        }
        texts.push((result.text || '').trim());
        offset += chunkDuration;
        debug(`Chunk ${i + 1}/${chunkFiles.length} transcribed (${result.segments.length} segments, offset now ${offset.toFixed(1)}s)`);
      }

      return {
        text: texts.filter(Boolean).join(' '),
        language: detectedLanguage,
        duration: offset,
        segments
      };
    } finally {
      await fs.remove(chunkDir).catch(() => {});
    }
  }

  /**
   * Process raw transcription segments for subtitle output
   * @param {Object} transcription - Raw Whisper API response
   * @returns {Array} Processed segments ready for subtitle generation
   */
  _processSegments(transcription) {
    if (!transcription.segments || transcription.segments.length === 0) {
      // Fallback: create single segment from full text
      return [{
        id: 1,
        start: 0,
        end: transcription.duration || 0,
        text: transcription.text.trim()
      }];
    }

    return transcription.segments.map((segment, index) => {
      return {
        id: index + 1,
        start: segment.start,
        end: segment.end,
        text: segment.text.trim(),
        tokens: segment.tokens || [],
        confidence: segment.avg_logprob || null
      };
    });
  }

  /**
   * Convert language codes to Whisper API format
   * Whisper uses ISO 639-1 (2-letter codes)
   * @param {string} langCode - Language code in any format
   * @returns {string} Whisper-compatible language code
   */
  _convertToWhisperLanguageCode(langCode) {
    if (!langCode) return undefined;

    const normalized = langCode.toLowerCase().trim();

    // Map 3-letter codes to 2-letter codes
    const mappings = {
      'eng': 'en',
      'jpn': 'ja',
      'spa': 'es',
      'fra': 'fr',
      'deu': 'de',
      'ita': 'it',
      'por': 'pt',
      'zho': 'zh',
      'kor': 'ko',
      'rus': 'ru',
      'ara': 'ar'
    };

    // Return mapped code or original if already 2 letters
    return mappings[normalized] || (normalized.length === 2 ? normalized : undefined);
  }

  /**
   * Estimate transcription cost
   * OpenAI Whisper costs $0.006 per minute
   * @param {number} durationSeconds - Audio duration in seconds
   * @returns {Object} Cost estimation
   */
  estimateCost(durationSeconds) {
    const minutes = durationSeconds / 60;
    const cost = minutes * 0.006;

    return {
      minutes: minutes.toFixed(2),
      cost: cost.toFixed(4),
      currency: 'USD'
    };
  }
}

module.exports = Transcriber;
