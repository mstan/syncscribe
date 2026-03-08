/**
 * FFmpeg Web Worker for client-side audio extraction.
 *
 * This worker handles loading ffmpeg.wasm and extracting audio from video files
 * in a background thread, keeping the main UI responsive.
 *
 * Messages IN:
 *   { type: 'extract', file: File }
 *
 * Messages OUT:
 *   { type: 'progress', progress: number, message: string }
 *   { type: 'complete', audioBuffer: ArrayBuffer, sha256: string, seconds: number }
 *   { type: 'error', message: string }
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpeg = null;

/**
 * Initialize the FFmpeg instance if not already loaded.
 */
async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;

  ffmpeg = new FFmpeg();

  ffmpeg.on('progress', ({ progress }) => {
    self.postMessage({
      type: 'progress',
      progress: Math.min(Math.round(progress * 100), 100),
      message: 'Extracting audio...'
    });
  });

  self.postMessage({ type: 'progress', progress: 0, message: 'Loading audio processor...' });

  await ffmpeg.load({
    coreURL: '/ffmpeg/ffmpeg-core.js',
    wasmURL: '/ffmpeg/ffmpeg-core.wasm'
  });

  return ffmpeg;
}

/**
 * Compute SHA-256 of an ArrayBuffer using Web Crypto API.
 */
async function computeSHA256(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Estimate audio duration from FLAC file size.
 * Mono 16kHz FLAC is roughly 16KB/s.
 */
function estimateAudioSeconds(bufferSize) {
  const bytesPerSecond = 16000;
  return Math.max(1, Math.round(bufferSize / bytesPerSecond));
}

/**
 * Process a video file: extract audio to mono 16kHz FLAC.
 */
async function extractAudio(file) {
  const ff = await getFFmpeg();

  // Write input file
  self.postMessage({ type: 'progress', progress: 0, message: 'Reading video file...' });
  const inputName = 'input' + file.name.substring(file.name.lastIndexOf('.'));
  await ff.writeFile(inputName, await fetchFile(file));

  // Extract audio
  self.postMessage({ type: 'progress', progress: 0, message: 'Extracting audio...' });
  await ff.exec([
    '-i', inputName,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'flac',
    'output.flac'
  ]);

  // Read output
  self.postMessage({ type: 'progress', progress: 95, message: 'Preparing audio data...' });
  const outputData = await ff.readFile('output.flac');
  const audioBuffer = outputData.buffer;

  // Cleanup
  try {
    await ff.deleteFile(inputName);
    await ff.deleteFile('output.flac');
  } catch {
    // Non-critical
  }

  // Compute hash
  self.postMessage({ type: 'progress', progress: 98, message: 'Computing file hash...' });
  const sha256 = await computeSHA256(audioBuffer);
  const seconds = estimateAudioSeconds(audioBuffer.byteLength);

  return { audioBuffer, sha256, seconds };
}

/**
 * Handle incoming messages from the main thread.
 */
self.addEventListener('message', async (event) => {
  const { type, file } = event.data;

  if (type === 'extract') {
    try {
      const result = await extractAudio(file);

      self.postMessage(
        {
          type: 'complete',
          audioBuffer: result.audioBuffer,
          sha256: result.sha256,
          seconds: result.seconds
        },
        [result.audioBuffer] // Transfer the buffer for zero-copy
      );
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: err.message || 'Audio extraction failed'
      });
    }
  }
});
