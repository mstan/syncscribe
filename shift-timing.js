require('dotenv').config();
const { Command } = require('commander');
const path = require('path');
const fs = require('fs-extra');

const program = new Command();

program
  .name('shift-timing')
  .description('Shift subtitle timing by a fixed offset (positive or negative)')
  .argument('<input>', 'Path to .srt file')
  .argument('<offset>', 'Time offset in seconds (e.g., 3 for +3s, -2.5 for -2.5s)')
  .option('-o, --output <path>', 'Output path (default: adds .shifted before .srt)')
  .parse(process.argv);

const options = program.opts();
const inputFile = program.args[0];
const offsetSeconds = parseFloat(program.args[1]);

/**
 * Parse SRT timestamp to milliseconds
 * Format: HH:MM:SS,mmm
 */
function parseTimestamp(timestamp) {
  const [time, ms] = timestamp.split(',');
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return (hours * 3600 + minutes * 60 + seconds) * 1000 + Number(ms);
}

/**
 * Format milliseconds to SRT timestamp
 * Format: HH:MM:SS,mmm
 */
function formatTimestamp(totalMs) {
  // Ensure non-negative
  if (totalMs < 0) totalMs = 0;

  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const pad = (num, len) => String(num).padStart(len, '0');

  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(ms, 3)}`;
}

/**
 * Shift all timestamps in an SRT file
 */
function shiftSubtitles(content, offsetMs) {
  const lines = content.split('\n');
  const shiftedLines = [];

  for (const line of lines) {
    // Check if line contains timestamp (format: HH:MM:SS,mmm --> HH:MM:SS,mmm)
    if (line.includes('-->')) {
      const [start, arrow, end] = line.split(' ');

      const startMs = parseTimestamp(start);
      const endMs = parseTimestamp(end);

      const newStart = formatTimestamp(startMs + offsetMs);
      const newEnd = formatTimestamp(endMs + offsetMs);

      shiftedLines.push(`${newStart} --> ${newEnd}`);
    } else {
      shiftedLines.push(line);
    }
  }

  return shiftedLines.join('\n');
}

async function main() {
  try {
    // Validate input
    if (!await fs.pathExists(inputFile)) {
      console.error(`❌ Error: File not found: ${inputFile}`);
      process.exit(1);
    }

    if (!inputFile.endsWith('.srt')) {
      console.error('❌ Error: Input file must be a .srt file');
      process.exit(1);
    }

    if (isNaN(offsetSeconds)) {
      console.error('❌ Error: Offset must be a number (e.g., 3 or -2.5)');
      process.exit(1);
    }

    const offsetMs = Math.round(offsetSeconds * 1000);
    const direction = offsetSeconds > 0 ? 'forward' : 'backward';
    const absSeconds = Math.abs(offsetSeconds);

    console.log(`\n⏱️  Shifting subtitles ${direction} by ${absSeconds} seconds...`);
    console.log(`Input: ${path.basename(inputFile)}\n`);

    // Read file
    const content = await fs.readFile(inputFile, 'utf8');

    // Shift timestamps
    const shifted = shiftSubtitles(content, offsetMs);

    // Determine output path
    let outputPath = options.output;
    if (!outputPath) {
      const parsed = path.parse(inputFile);
      const sign = offsetSeconds > 0 ? '+' : '';
      outputPath = path.join(parsed.dir, `${parsed.name}.shifted${sign}${offsetSeconds}s.srt`);
    }

    // Write output
    await fs.writeFile(outputPath, shifted, 'utf8');

    console.log('✅ Timing shifted successfully!\n');
    console.log('Generated file:');
    console.log(`   ${path.basename(outputPath)}`);
    console.log(`\n   Offset applied: ${offsetSeconds > 0 ? '+' : ''}${offsetSeconds} seconds\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
