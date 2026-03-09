// lib/Transcriber.js
const debug = require('debug')('SubtitleGenerator:Transcriber');
const OpenAI = require('openai');
const fs = require('fs-extra');

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
  }

  async init() {
    // Initialize OpenAI client
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY not found in environment variables. ' +
        'Please add it to your .env file or set it as an environment variable.'
      );
    }

    this.client = new OpenAI({
      apiKey: apiKey
    });

    debug('Transcriber initialized with OpenAI Whisper API');
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
          model: 'whisper-1',
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
        throw new Error('OpenAI API authentication failed. Please check your OPENAI_API_KEY.');
      }

      if (error.status === 429) {
        throw new Error('OpenAI API rate limit exceeded after retries. Please try again later.');
      }

      throw new Error(`Transcription failed: ${error.message}`);
    }
  }

  /**
   * Transcribe audio from a Buffer (for web uploads, no file path needed)
   * @param {Buffer} audioBuffer - Audio data buffer
   * @param {Object} options - Transcription options
   * @param {string} options.language - Language code
   * @param {string} [options.filename='audio.flac'] - Filename for the API
   * @returns {Promise<Object>} Transcription result with segments
   */
  async transcribeBuffer(audioBuffer, options = {}) {
    const { language, filename = 'audio.flac' } = options;

    debug(`Transcribing buffer: ${(audioBuffer.length / (1024 * 1024)).toFixed(2)} MB`);

    if (audioBuffer.length > 25 * 1024 * 1024) {
      throw new Error(
        `Audio buffer is ${(audioBuffer.length / (1024 * 1024)).toFixed(2)} MB, which exceeds Whisper's 25 MB limit.`
      );
    }

    try {
      const transcription = await withRetry(async () => {
        const file = await OpenAI.toFile(audioBuffer, filename);
        return this.client.audio.transcriptions.create({
          file: file,
          model: 'whisper-1',
          response_format: 'verbose_json',
          language: language ? this._convertToWhisperLanguageCode(language) : undefined,
          timestamp_granularities: ['word', 'segment']
        });
      }, 'Whisper buffer transcription');

      debug(`Buffer transcription completed: ${transcription.segments?.length || 0} segments`);

      const segments = this._processSegments(transcription);

      return {
        text: transcription.text,
        language: transcription.language,
        duration: transcription.duration,
        segments: segments,
        raw: transcription
      };
    } catch (error) {
      debug('Buffer transcription error:', error);
      if (error.status === 401) {
        throw new Error('OpenAI API authentication failed. Please check your OPENAI_API_KEY.');
      }
      if (error.status === 429) {
        throw new Error('OpenAI API rate limit exceeded after retries. Please try again later.');
      }
      throw new Error(`Transcription failed: ${error.message}`);
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
