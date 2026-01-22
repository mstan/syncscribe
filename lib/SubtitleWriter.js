// lib/SubtitleWriter.js
const debug = require('debug')('SubtitleGenerator:SubtitleWriter');
const fs = require('fs-extra');
const path = require('path');

class SubtitleWriter {
  constructor(handler) {
    this.handler = handler;
  }

  async init() {
    debug('SubtitleWriter initialized');
  }

  /**
   * Write subtitles to SRT file
   * @param {string} outputPath - Path for output subtitle file
   * @param {Object} transcription - Transcription object with segments
   * @returns {Promise<void>}
   */
  async writeSubtitles(outputPath, transcription) {
    debug(`Writing subtitles to: ${outputPath}`);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    await fs.mkdirp(outputDir);

    // Generate SRT content
    const srtContent = this._generateSRT(transcription.segments);

    // Write to file
    await fs.writeFile(outputPath, srtContent, 'utf8');

    debug(`Subtitle file written successfully`);
  }

  /**
   * Generate SRT format content from segments
   * SRT format:
   * 1
   * 00:00:01,000 --> 00:00:04,000
   * Subtitle text line 1
   * Subtitle text line 2
   *
   * 2
   * 00:00:05,000 --> 00:00:08,000
   * Next subtitle text
   *
   * @param {Array} segments - Transcription segments
   * @returns {string} SRT formatted string
   */
  _generateSRT(segments) {
    const srtBlocks = segments.map((segment, index) => {
      const sequenceNumber = index + 1;
      const startTime = this._formatSRTTimestamp(segment.start);
      const endTime = this._formatSRTTimestamp(segment.end);

      // Split text into multiple lines if too long (max ~42 characters per line)
      const textLines = this._splitTextIntoLines(segment.text, 42);

      // Build SRT block
      const block = [
        sequenceNumber.toString(),
        `${startTime} --> ${endTime}`,
        ...textLines,
        '' // Empty line separator
      ].join('\n');

      return block;
    });

    return srtBlocks.join('\n');
  }

  /**
   * Format timestamp for SRT format
   * SRT format: HH:MM:SS,mmm (e.g., 00:01:23,456)
   * @param {number} seconds - Time in seconds (can be float)
   * @returns {string} Formatted timestamp
   */
  _formatSRTTimestamp(seconds) {
    const totalMilliseconds = Math.floor(seconds * 1000);
    const milliseconds = totalMilliseconds % 1000;
    const totalSeconds = Math.floor(totalMilliseconds / 1000);
    const secs = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const mins = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);

    // Format: HH:MM:SS,mmm
    return `${this._pad(hours, 2)}:${this._pad(mins, 2)}:${this._pad(secs, 2)},${this._pad(milliseconds, 3)}`;
  }

  /**
   * Pad number with leading zeros
   * @param {number} num - Number to pad
   * @param {number} size - Target size
   * @returns {string} Padded string
   */
  _pad(num, size) {
    let s = num.toString();
    while (s.length < size) s = '0' + s;
    return s;
  }

  /**
   * Split long text into multiple lines for subtitle display
   * Tries to break at natural word boundaries
   * @param {string} text - Text to split
   * @param {number} maxLength - Maximum characters per line
   * @returns {Array<string>} Array of text lines
   */
  _splitTextIntoLines(text, maxLength = 42) {
    // If text is short enough, return as-is
    if (text.length <= maxLength) {
      return [text];
    }

    const lines = [];
    const words = text.split(' ');
    let currentLine = '';

    for (const word of words) {
      // If adding this word would exceed max length
      if ((currentLine + ' ' + word).trim().length > maxLength) {
        if (currentLine) {
          lines.push(currentLine.trim());
          currentLine = word;
        } else {
          // Single word longer than maxLength - just add it
          lines.push(word);
          currentLine = '';
        }
      } else {
        currentLine = currentLine ? currentLine + ' ' + word : word;
      }
    }

    // Add remaining text
    if (currentLine) {
      lines.push(currentLine.trim());
    }

    // Limit to 2 lines per subtitle (standard practice)
    if (lines.length > 2) {
      // Combine into 2 lines, trying to balance length
      const halfLength = Math.ceil(words.length / 2);
      const firstHalf = words.slice(0, halfLength).join(' ');
      const secondHalf = words.slice(halfLength).join(' ');
      return [firstHalf, secondHalf];
    }

    return lines;
  }

  /**
   * Generate WebVTT format instead of SRT
   * WebVTT is more modern and supports additional features
   * @param {Array} segments - Transcription segments
   * @returns {string} WebVTT formatted string
   */
  _generateWebVTT(segments) {
    const vttHeader = 'WEBVTT\n\n';

    const vttCues = segments.map((segment, index) => {
      const sequenceNumber = index + 1;
      const startTime = this._formatVTTTimestamp(segment.start);
      const endTime = this._formatVTTTimestamp(segment.end);

      const textLines = this._splitTextIntoLines(segment.text, 42);

      const cue = [
        sequenceNumber.toString(),
        `${startTime} --> ${endTime}`,
        ...textLines,
        '' // Empty line separator
      ].join('\n');

      return cue;
    });

    return vttHeader + vttCues.join('\n');
  }

  /**
   * Format timestamp for WebVTT format
   * WebVTT format: HH:MM:SS.mmm (e.g., 00:01:23.456)
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted timestamp
   */
  _formatVTTTimestamp(seconds) {
    const totalMilliseconds = Math.floor(seconds * 1000);
    const milliseconds = totalMilliseconds % 1000;
    const totalSeconds = Math.floor(totalMilliseconds / 1000);
    const secs = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const mins = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);

    // Format: HH:MM:SS.mmm (note the period instead of comma)
    return `${this._pad(hours, 2)}:${this._pad(mins, 2)}:${this._pad(secs, 2)}.${this._pad(milliseconds, 3)}`;
  }

  /**
   * Write subtitles in WebVTT format
   * @param {string} outputPath - Path for output subtitle file
   * @param {Object} transcription - Transcription object with segments
   * @returns {Promise<void>}
   */
  async writeWebVTT(outputPath, transcription) {
    debug(`Writing WebVTT subtitles to: ${outputPath}`);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    await fs.mkdirp(outputDir);

    // Generate WebVTT content
    const vttContent = this._generateWebVTT(transcription.segments);

    // Write to file
    await fs.writeFile(outputPath, vttContent, 'utf8');

    debug(`WebVTT subtitle file written successfully`);
  }
}

module.exports = SubtitleWriter;
