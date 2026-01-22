// lib/AudioAnalyzer.js
const debug = require('debug')('SubtitleGenerator:AudioAnalyzer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

// Set ffmpeg and ffprobe paths
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

class AudioAnalyzer {
  constructor(handler) {
    this.handler = handler;
  }

  async init() {
    debug('AudioAnalyzer initialized');
  }

  /**
   * Analyze video file and extract audio track information
   * @param {string} videoPath - Path to video file
   * @returns {Promise<Object>} Video info with parsed audio tracks
   */
  async analyzeVideo(videoPath) {
    debug(`Analyzing video: ${videoPath}`);

    const metadata = await this._getMetadata(videoPath);

    // Extract audio streams
    const audioStreams = metadata.streams.filter(stream => stream.codec_type === 'audio');

    debug(`Found ${audioStreams.length} audio stream(s)`);

    const audioTracks = audioStreams.map((stream, idx) => {
      return {
        index: idx,
        streamIndex: stream.index,
        codec: stream.codec_name,
        language: this._parseLanguage(stream),
        channels: stream.channels,
        sampleRate: stream.sample_rate,
        bitrate: stream.bit_rate,
        duration: stream.duration || metadata.format.duration,
        tags: stream.tags || {}
      };
    });

    return {
      format: metadata.format,
      audioTracks: audioTracks,
      videoStreams: metadata.streams.filter(s => s.codec_type === 'video'),
      rawMetadata: metadata
    };
  }

  /**
   * Get raw metadata from video file using ffprobe
   * @param {string} videoPath - Path to video file
   * @returns {Promise<Object>} Raw ffprobe metadata
   */
  async _getMetadata(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          debug('FFprobe error:', err);
          reject(new Error(`Failed to read video metadata: ${err.message}`));
          return;
        }
        resolve(metadata);
      });
    });
  }

  /**
   * Parse language from audio stream
   * Checks multiple possible tag locations for language info
   * @param {Object} stream - FFprobe audio stream object
   * @returns {string|null} Language code (e.g., 'eng', 'jpn') or null
   */
  _parseLanguage(stream) {
    if (!stream.tags) {
      return null;
    }

    // Check various possible language tag keys
    const languageKeys = ['language', 'lang', 'LANGUAGE', 'LANG'];

    for (const key of languageKeys) {
      if (stream.tags[key]) {
        return this._normalizeLanguageCode(stream.tags[key]);
      }
    }

    // Check title for language hints (e.g., "English", "Japanese")
    if (stream.tags.title) {
      const detectedLang = this._detectLanguageFromTitle(stream.tags.title);
      if (detectedLang) {
        return detectedLang;
      }
    }

    return null;
  }

  /**
   * Normalize language codes to ISO 639-2/B format (3-letter codes)
   * @param {string} langCode - Language code in any format
   * @returns {string} Normalized language code
   */
  _normalizeLanguageCode(langCode) {
    const normalized = langCode.toLowerCase().trim();

    // Common language code mappings
    const mappings = {
      'en': 'eng',
      'english': 'eng',
      'ja': 'jpn',
      'jp': 'jpn',
      'japanese': 'jpn',
      'es': 'spa',
      'spanish': 'spa',
      'fr': 'fra',
      'french': 'fra',
      'de': 'deu',
      'german': 'deu',
      'it': 'ita',
      'italian': 'ita',
      'pt': 'por',
      'portuguese': 'por',
      'zh': 'zho',
      'chinese': 'zho',
      'ko': 'kor',
      'korean': 'kor',
      'ru': 'rus',
      'russian': 'rus',
      'ar': 'ara',
      'arabic': 'ara'
    };

    // Return mapped code or original if already 3 letters
    return mappings[normalized] || (normalized.length === 3 ? normalized : normalized);
  }

  /**
   * Detect language from track title string
   * @param {string} title - Track title
   * @returns {string|null} Detected language code or null
   */
  _detectLanguageFromTitle(title) {
    const lowerTitle = title.toLowerCase();

    const patterns = [
      { pattern: /english|eng/i, lang: 'eng' },
      { pattern: /japanese|jpn|japan/i, lang: 'jpn' },
      { pattern: /spanish|spa|español/i, lang: 'spa' },
      { pattern: /french|fra|français/i, lang: 'fra' },
      { pattern: /german|deu|deutsch/i, lang: 'deu' },
      { pattern: /italian|ita|italiano/i, lang: 'ita' },
      { pattern: /portuguese|por|português/i, lang: 'por' },
      { pattern: /chinese|zho|中文/i, lang: 'zho' },
      { pattern: /korean|kor|한국어/i, lang: 'kor' },
      { pattern: /russian|rus|русский/i, lang: 'rus' }
    ];

    for (const { pattern, lang } of patterns) {
      if (pattern.test(lowerTitle)) {
        return lang;
      }
    }

    return null;
  }

  /**
   * Get duration of audio track in seconds
   * @param {string} videoPath - Path to video file
   * @param {number} trackIndex - Audio track index
   * @returns {Promise<number>} Duration in seconds
   */
  async getAudioDuration(videoPath, trackIndex = 0) {
    const videoInfo = await this.analyzeVideo(videoPath);

    if (trackIndex >= videoInfo.audioTracks.length) {
      throw new Error(`Audio track ${trackIndex} not found`);
    }

    const duration = parseFloat(videoInfo.audioTracks[trackIndex].duration);
    return duration;
  }
}

module.exports = AudioAnalyzer;
