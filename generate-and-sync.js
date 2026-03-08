require('dotenv').config();
const { Command } = require('commander');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

const program = new Command();

program
  .name('generate-and-sync')
  .description('Generate subtitles with Whisper and sync to video with ffsubsync (complete pipeline)')
  .requiredOption('-i, --input <path>', 'Path to input video file (.mkv, .mp4, etc.)')
  .option('-l, --language <code>', 'Language code (e.g., en, ja, es)', 'en')
  .option('--skip-sync', 'Skip ffsubsync step (use raw Whisper timestamps)')
  .parse(process.argv);

const options = program.opts();

function runCommand(command, args, description) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📍 ${description}`);
    console.log(`${'='.repeat(80)}\n`);

    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });

    child.on('error', (err) => reject(err));
  });
}

async function main() {
  try {
    const inputFile = path.resolve(options.input);

    if (!await fs.pathExists(inputFile)) {
      console.error(`❌ Error: File not found: ${inputFile}`);
      process.exit(1);
    }

    const ext = path.extname(inputFile);
    const basePath = inputFile.replace(ext, '');
    const audioFile = `${basePath}.mp3`;

    console.log('\n🎬 Subtitle Generation Pipeline');
    console.log('━'.repeat(80));
    console.log(`Video:    ${path.basename(inputFile)}`);
    console.log(`Language: ${options.language}`);
    console.log(`Sync:     ${options.skipSync ? 'Disabled' : 'Enabled (ffsubsync)'}`);
    console.log('━'.repeat(80));

    // Check if audio already exists
    const hasAudio = await fs.pathExists(audioFile);

    // Step 1: Extract audio (if needed)
    if (!hasAudio) {
      console.log('\n📦 Step 1: Extracting audio from video...\n');
      const VideoProcessor = require('./lib/VideoProcessor');
      const AudioAnalyzer = require('./lib/AudioAnalyzer');

      const mockHandler = {
        appRootPath: process.cwd(),
        tmpFileDir: path.join(process.cwd(), 'tmp')
      };

      const videoProcessor = new VideoProcessor(mockHandler);
      await videoProcessor.init();

      const audioAnalyzer = new AudioAnalyzer(mockHandler);
      await audioAnalyzer.init();

      const videoInfo = await audioAnalyzer.analyzeVideo(inputFile);
      const outputPath = await videoProcessor.extractAudio(inputFile, 0);

      // Move to same directory as video
      await fs.move(outputPath, audioFile, { overwrite: true });
      console.log(`✓ Audio extracted: ${path.basename(audioFile)}\n`);
    } else {
      console.log('\n✓ Audio already exists, skipping extraction\n');
    }

    // Step 2: Transcribe with Whisper
    const transcribeArgs = ['-i', audioFile, '--auto'];
    if (options.language) transcribeArgs.push('--language', options.language);

    await runCommand('node', ['cli.js', ...transcribeArgs], 'Step 2: Transcribing with Whisper API');

    const rawSrtPath = `${basePath}.srt`;

    // Step 3: Sync with ffsubsync (unless skipped)
    if (!options.skipSync) {
      const syncedPath = `${basePath}.synced.srt`;

      await runCommand(
        'ffsubsync',
        [inputFile, '-i', rawSrtPath, '-o', syncedPath],
        'Step 3: Syncing subtitles to video with ffsubsync'
      );

      // Replace original with synced version
      await fs.move(syncedPath, rawSrtPath, { overwrite: true });
      console.log(`\n✓ Subtitles synced and saved: ${path.basename(rawSrtPath)}`);
    }

    // Summary
    console.log('\n' + '━'.repeat(80));
    console.log('✨ Subtitle generation complete!');
    console.log('━'.repeat(80));
    console.log('\nGenerated files:');
    console.log(`  • ${path.basename(audioFile)} - Extracted audio`);
    console.log(`  • ${path.basename(rawSrtPath)} - ${options.skipSync ? 'Subtitles' : 'Subtitles (synced)'}`);
    console.log('\n💰 Cost: ~$0.14 (Whisper API transcription)');
    console.log('');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
