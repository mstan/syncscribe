require('dotenv').config();
const debug = require('debug')('SubtitleGenerator:extract-audio');
const { Command } = require('commander');
const path = require('path');
const fs = require('fs-extra');
const VideoProcessor = require('./lib/VideoProcessor.js');
const AudioAnalyzer = require('./lib/AudioAnalyzer.js');

const program = new Command();

program
  .name('extract-audio')
  .description('Batch extract audio from video files to MP3 format')
  .option('-d, --dir <path>', 'Directory to scan for videos (default: ./src)', './src')
  .option('-r, --recursive', 'Recursively scan subdirectories', true)
  .option('-t, --track <number>', 'Audio track to extract (default: 0)', '0')
  .option('-f, --force', 'Force re-extraction even if MP3 already exists', false)
  .option('--skip-existing', 'Skip files that already have extracted audio', true)
  .option('--debug', 'Enable debug logging')
  .parse(process.argv);

const options = program.opts();

// Video file extensions to look for
const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v'];

class AudioExtractor {
  constructor() {
    this.videoProcessor = null;
    this.audioAnalyzer = null;
    this.stats = {
      total: 0,
      extracted: 0,
      skipped: 0,
      failed: 0
    };
  }

  async init() {
    // Create mock handler object for services
    const mockHandler = {
      appRootPath: process.cwd(),
      tmpFileDir: path.join(process.cwd(), 'tmp')
    };

    await fs.mkdirp(mockHandler.tmpFileDir);

    this.videoProcessor = new VideoProcessor(mockHandler);
    await this.videoProcessor.init();

    this.audioAnalyzer = new AudioAnalyzer(mockHandler);
    await this.audioAnalyzer.init();

    debug('AudioExtractor initialized');
  }

  /**
   * Find all video files in directory
   */
  async findVideoFiles(dir, recursive = true) {
    const videoFiles = [];

    const scan = async (currentDir) => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory() && recursive) {
          await scan(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (VIDEO_EXTENSIONS.includes(ext)) {
            videoFiles.push(fullPath);
          }
        }
      }
    };

    await scan(dir);
    return videoFiles;
  }

  /**
   * Get output audio path for a video file
   */
  getAudioPath(videoPath, trackNumber = 0) {
    const parsed = path.parse(videoPath);
    const audioFilename = trackNumber === 0
      ? `${parsed.name}.mp3`
      : `${parsed.name}-track${trackNumber}.mp3`;
    return path.join(parsed.dir, audioFilename);
  }

  /**
   * Extract audio from a single video file
   */
  async extractFromVideo(videoPath, trackNumber = 0, force = false) {
    const audioPath = this.getAudioPath(videoPath, trackNumber);

    // Check if audio already exists
    if (!force && await fs.pathExists(audioPath)) {
      console.log(`⏭️  Skipping (audio exists): ${path.basename(videoPath)}`);
      this.stats.skipped++;
      return { success: true, skipped: true };
    }

    try {
      console.log(`\n🎬 Processing: ${path.basename(videoPath)}`);

      // Analyze video to get track info
      const videoInfo = await this.audioAnalyzer.analyzeVideo(videoPath);

      if (videoInfo.audioTracks.length === 0) {
        console.log(`   ⚠️  No audio tracks found`);
        this.stats.failed++;
        return { success: false, error: 'No audio tracks' };
      }

      // Verify track exists
      if (trackNumber >= videoInfo.audioTracks.length) {
        console.log(`   ⚠️  Track ${trackNumber} not found (only ${videoInfo.audioTracks.length} tracks available)`);
        trackNumber = 0;
        console.log(`   ℹ️  Using track 0 instead`);
      }

      const selectedTrack = videoInfo.audioTracks[trackNumber];
      const lang = selectedTrack.language || 'unknown';
      console.log(`   📻 Extracting track ${trackNumber} (${lang})`);

      // Extract audio directly to final location
      await this.extractAudioToFile(videoPath, audioPath, trackNumber);

      // Get file size
      const stats = await fs.stat(audioPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      console.log(`   ✅ Extracted: ${path.basename(audioPath)} (${sizeMB} MB)`);
      this.stats.extracted++;

      return { success: true, audioPath, sizeMB };

    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);
      debug('Extraction error:', error);
      this.stats.failed++;
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract audio using ffmpeg directly to output file
   */
  async extractAudioToFile(videoPath, outputPath, trackIndex = 0) {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegStatic = require('ffmpeg-static');
    const ffprobeStatic = require('ffprobe-static');

    ffmpeg.setFfmpegPath(ffmpegStatic);
    ffmpeg.setFfprobePath(ffprobeStatic.path);

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          `-map 0:a:${trackIndex}`,
          '-acodec libmp3lame',
          '-ar 16000',         // 16kHz for Whisper
          '-ac 1',             // Mono
          '-b:a 64k'           // 64kbps
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          debug('FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            process.stdout.write(`   Progress: ${Math.round(progress.percent)}%\r`);
          }
        })
        .on('end', () => {
          process.stdout.write('\r');
          resolve();
        })
        .on('error', (err) => {
          reject(err);
        })
        .run();
    });
  }

  /**
   * Batch process all videos in directory
   */
  async processDirectory(dir, trackNumber = 0, force = false) {
    console.log(`\n🔍 Scanning directory: ${dir}`);
    console.log(`   Recursive: ${options.recursive ? 'Yes' : 'No'}`);
    console.log(`   Track: ${trackNumber}`);
    console.log(`   Force re-extraction: ${force ? 'Yes' : 'No'}\n`);

    const videoFiles = await this.findVideoFiles(dir, options.recursive);

    if (videoFiles.length === 0) {
      console.log('❌ No video files found');
      return;
    }

    console.log(`📹 Found ${videoFiles.length} video file(s)\n`);
    console.log('─'.repeat(80));

    this.stats.total = videoFiles.length;

    // Process each video
    for (let i = 0; i < videoFiles.length; i++) {
      const videoPath = videoFiles[i];
      console.log(`\n[${i + 1}/${videoFiles.length}]`);
      await this.extractFromVideo(videoPath, trackNumber, force);
    }

    // Print summary
    console.log('\n' + '─'.repeat(80));
    console.log('\n📊 Extraction Summary:');
    console.log(`   Total files:     ${this.stats.total}`);
    console.log(`   ✅ Extracted:    ${this.stats.extracted}`);
    console.log(`   ⏭️  Skipped:      ${this.stats.skipped}`);
    console.log(`   ❌ Failed:       ${this.stats.failed}`);
    console.log('');
  }
}

async function main() {
  try {
    if (options.debug) {
      require('debug').enable('SubtitleGenerator:*');
    }

    const extractor = new AudioExtractor();
    await extractor.init();

    const targetDir = path.resolve(options.dir);

    // Check if directory exists
    if (!await fs.pathExists(targetDir)) {
      console.error(`Error: Directory does not exist: ${targetDir}`);
      process.exit(1);
    }

    const trackNumber = parseInt(options.track);

    await extractor.processDirectory(targetDir, trackNumber, options.force);

    console.log('✨ Batch extraction complete!\n');

  } catch (error) {
    console.error('Error:', error.message);
    debug('Full error:', error);
    process.exit(1);
  }
}

main();
