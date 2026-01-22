require('dotenv').config();
const { Command } = require('commander');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

const program = new Command();

program
  .name('sync-subtitles')
  .description('Synchronize subtitle file to audio/video using ffsubsync (audio fingerprinting)')
  .argument('<subtitle>', 'Path to .srt subtitle file to sync')
  .argument('<media>', 'Path to video/audio file to sync against')
  .option('-o, --output <path>', 'Output path for synced subtitle')
  .parse(process.argv);

const options = program.opts();
const subtitleFile = program.args[0];
const mediaFile = program.args[1];

async function checkDependency() {
  return new Promise((resolve) => {
    const child = spawn('ffsubsync', ['--help']);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0 || code === 1));
  });
}

async function syncSubtitles(srtPath, videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      srtPath,
      '-i', videoPath,
      '-o', outputPath
    ];

    console.log(`Running: ffsubsync ${args.join(' ')}\n`);

    const child = spawn('ffsubsync', args, {
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffsubsync exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  try {
    console.log('\n🎯 Subtitle Synchronization using ffsubsync\n');

    // Check if files exist
    if (!await fs.pathExists(subtitleFile)) {
      console.error(`❌ Error: Subtitle file not found: ${subtitleFile}`);
      process.exit(1);
    }

    if (!await fs.pathExists(mediaFile)) {
      console.error(`❌ Error: Media file not found: ${mediaFile}`);
      process.exit(1);
    }

    // Check if ffsubsync is installed
    console.log('Checking for ffsubsync...');
    const hasFFSubSync = await checkDependency();

    if (!hasFFSubSync) {
      console.error('❌ Error: ffsubsync is not installed\n');
      console.log('Install instructions:');
      console.log('  pip install ffsubsync');
      console.log('\nOr visit: https://github.com/smacke/ffsubsync\n');
      process.exit(1);
    }

    console.log('✓ ffsubsync found\n');

    // Determine output path
    let outputPath = options.output;
    if (!outputPath) {
      const parsed = path.parse(subtitleFile);
      outputPath = path.join(parsed.dir, `${parsed.name}.synced.srt`);
    }

    console.log('Synchronizing subtitles to audio...');
    console.log(`  Subtitle: ${path.basename(subtitleFile)}`);
    console.log(`  Media:    ${path.basename(mediaFile)}`);
    console.log(`  Output:   ${path.basename(outputPath)}\n`);

    await syncSubtitles(subtitleFile, mediaFile, outputPath);

    console.log('\n✅ Synchronization complete!');
    console.log(`\nSynced subtitle saved to: ${path.basename(outputPath)}\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
