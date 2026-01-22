// lib/VideoProcessor.js
const debug = require('debug')('SubtitleGenerator:VideoProcessor');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const path = require('path');
const fs = require('fs-extra');

// Set ffmpeg and ffprobe paths
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

class VideoProcessor {
  constructor(handler) {
    this.handler = handler;
  }

  async init() {
    debug('VideoProcessor initialized');
  }

  /**
   * Extract audio from video file
   * @param {string} videoPath - Path to input video file
   * @param {number} trackIndex - Audio track index to extract
   * @returns {Promise<string>} Path to extracted audio file
   */
  async extractAudio(videoPath, trackIndex = 0) {
    debug(`Extracting audio from ${videoPath}, track ${trackIndex}`);

    const videoBasename = path.basename(videoPath, path.extname(videoPath));
    const outputFilename = `${videoBasename}_track${trackIndex}_${Date.now()}.mp3`;
    const outputPath = path.join(this.handler.tmpFileDir, outputFilename);

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          `-map 0:a:${trackIndex}`,  // Select specific audio track
          '-acodec libmp3lame',       // Convert to MP3
          '-ar 16000',                // 16kHz sample rate (Whisper optimal)
          '-ac 1',                    // Mono channel (reduces file size, Whisper handles it well)
          '-b:a 64k'                  // 64kbps bitrate (sufficient for speech)
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          debug('FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            process.stdout.write(`\rProgress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          process.stdout.write('\r');
          debug(`Audio extraction complete: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err, stdout, stderr) => {
          debug('FFmpeg error:', err.message);
          debug('FFmpeg stderr:', stderr);
          reject(new Error(`Failed to extract audio: ${err.message}`));
        })
        .run();
    });
  }

  /**
   * Get basic info about a video file
   * @param {string} videoPath - Path to video file
   * @returns {Promise<Object>} Video metadata
   */
  async getVideoInfo(videoPath) {
    debug(`Getting video info for ${videoPath}`);

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          debug('FFprobe error:', err);
          reject(new Error(`Failed to read video metadata: ${err.message}`));
          return;
        }

        debug('Video metadata retrieved');
        resolve(metadata);
      });
    });
  }

  /**
   * Extract audio with high quality for better transcription
   * Used when accuracy is more important than file size
   * @param {string} videoPath - Path to input video file
   * @param {number} trackIndex - Audio track index to extract
   * @returns {Promise<string>} Path to extracted audio file
   */
  async extractAudioHighQuality(videoPath, trackIndex = 0) {
    debug(`Extracting high-quality audio from ${videoPath}, track ${trackIndex}`);

    const videoBasename = path.basename(videoPath, path.extname(videoPath));
    const outputFilename = `${videoBasename}_track${trackIndex}_hq_${Date.now()}.wav`;
    const outputPath = path.join(this.handler.tmpFileDir, outputFilename);

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          `-map 0:a:${trackIndex}`,
          '-acodec pcm_s16le',  // Uncompressed WAV
          '-ar 16000',          // 16kHz sample rate
          '-ac 1'               // Mono
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          debug('FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            process.stdout.write(`\rProgress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          process.stdout.write('\r');
          debug(`High-quality audio extraction complete: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err, stdout, stderr) => {
          debug('FFmpeg error:', err.message);
          debug('FFmpeg stderr:', stderr);
          reject(new Error(`Failed to extract audio: ${err.message}`));
        })
        .run();
    });
  }
}

module.exports = VideoProcessor;
