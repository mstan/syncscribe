require('dotenv').config();
const debug = require('debug')('SubtitleGenerator:app');
const { Command } = require('commander');
const SubtitleGenerator = require('./lib/SubtitleGenerator.js');
const appRootPath = require('app-root-path').toString();
const path = require('path');

process.env.APP_ROOT_PATH = appRootPath;

const program = new Command();

program
  .name('syncscribe')
  .description('AI-powered subtitle generation with automatic timing synchronization')
  .version('1.0.0')
  .requiredOption('-i, --input <path>', 'Path to input video file')
  .option('-l, --language <code>', 'Force specific language (e.g., en, ja, es). If not specified, will auto-detect or prompt.')
  .option('-o, --output <path>', 'Output path for subtitle file (default: same as input with .srt extension)')
  .option('--track <number>', 'Specify audio track number to use (default: prompts if multiple tracks)')
  .option('--auto', 'Automatically use first audio track if multiple exist (no prompt)')
  .option('--debug', 'Enable debug logging')
  .parse(process.argv);

const options = program.opts();

async function main() {
  try {
    // Enable debug if flag is set
    if (options.debug) {
      require('debug').enable('SubtitleGenerator:*');
    }

    debug('Starting Syncscribe with options:', options);

    // Validate input file
    const fs = require('fs-extra');
    if (!await fs.pathExists(options.input)) {
      console.error(`Error: Input file does not exist: ${options.input}`);
      process.exit(1);
    }

    // Determine output path
    if (!options.output) {
      const parsedPath = path.parse(options.input);
      options.output = path.join(parsedPath.dir, `${parsedPath.name}.srt`);
    }

    debug(`Input: ${options.input}`);
    debug(`Output: ${options.output}`);

    // Initialize Syncscribe generator
    const generator = new SubtitleGenerator({
      appRootPath,
      debugMode: !!options.debug
    });

    await generator.init();

    // Generate subtitles
    await generator.generateSubtitles({
      inputPath: options.input,
      outputPath: options.output,
      language: options.language,
      trackNumber: options.track ? parseInt(options.track) : null,
      autoConfirm: !!options.auto
    });

    console.log(`\nSubtitles generated successfully: ${options.output}`);

  } catch (error) {
    console.error('Error:', error.message);
    debug('Full error:', error);
    process.exit(1);
  }
}

main();

process.on('uncaughtException', (exception) => {
  debug('Uncaught exception:', exception);
  console.error('Fatal error:', exception.message);
  process.exit(1);
});

process.on('unhandledRejection', (exception) => {
  debug('Unhandled rejection:', exception);
  console.error('Fatal error:', exception.message);
  process.exit(1);
});
