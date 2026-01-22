// lib/Transcriber.js
const debug = require('debug')('SubtitleGenerator:Transcriber');
const OpenAI = require('openai');
const fs = require('fs-extra');

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
      // Create transcription request
      const transcription = await this.client.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-1',
        response_format: 'verbose_json',  // Includes word-level timestamps
        language: language ? this._convertToWhisperLanguageCode(language) : undefined,
        timestamp_granularities: ['word', 'segment']  // Get both word and segment timestamps for better accuracy
      });

      debug(`Transcription completed: ${transcription.segments?.length || 0} segments`);

      // Process segments for subtitle format
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
        throw new Error('OpenAI API rate limit exceeded. Please try again later.');
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
