// lib/SubtitleGenerator.js
const debug = require('debug')('SubtitleGenerator:SubtitleGenerator');
const path = require('path');
const fs = require('fs-extra');
const inquirer = require('inquirer');

const VideoProcessor = require('./VideoProcessor');
const AudioAnalyzer = require('./AudioAnalyzer');
const Transcriber = require('./Transcriber');
const SubtitleWriter = require('./SubtitleWriter');
const Translator = require('./Translator');

class SubtitleGenerator {
  constructor({ appRootPath, debugMode }) {
    this.appRootPath = appRootPath;
    this.debugMode = debugMode;
    this.tmpFileDir = path.join(this.appRootPath, 'tmp');
    this.outputFileDir = path.join(this.appRootPath, 'output');

    // Service instances
    this.videoProcessor = null;
    this.audioAnalyzer = null;
    this.transcriber = null;
    this.subtitleWriter = null;
    this.translator = null;
  }

  async init() {
    debug('Initializing SubtitleGenerator');

    // Ensure directories exist
    await fs.mkdirp(this.tmpFileDir);
    await fs.mkdirp(this.outputFileDir);

    // Initialize services
    this.videoProcessor = new VideoProcessor(this);
    await this.videoProcessor.init();

    this.audioAnalyzer = new AudioAnalyzer(this);
    await this.audioAnalyzer.init();

    this.transcriber = new Transcriber(this);
    await this.transcriber.init();

    this.subtitleWriter = new SubtitleWriter(this);
    await this.subtitleWriter.init();

    this.translator = new Translator(this);
    await this.translator.init();

    debug('SubtitleGenerator initialized successfully');
  }

  async generateSubtitles(options) {
    const {
      inputPath,
      outputPath,
      language,
      languages,
      trackNumber,
      autoConfirm
    } = options;

    debug('Starting subtitle generation process');
    console.log(`Processing video: ${path.basename(inputPath)}`);

    // Determine target languages
    const targetLanguages = languages && languages.length > 0 ? languages : (language ? [language] : null);

    if (targetLanguages && targetLanguages.length > 0) {
      console.log(`Target languages: ${targetLanguages.join(', ')}`);
    }

    try {
      // Step 1: Analyze video file for audio tracks
      console.log('\nAnalyzing video file...');
      const videoInfo = await this.audioAnalyzer.analyzeVideo(inputPath);
      const audioTracks = videoInfo.audioTracks;

      debug(`Found ${audioTracks.length} audio track(s)`);

      if (audioTracks.length === 0) {
        throw new Error('No audio tracks found in video file');
      }

      // Step 2: Determine which audio track to use
      let selectedTrack;

      if (trackNumber !== null) {
        // User specified track number via CLI
        selectedTrack = audioTracks.find(t => t.index === trackNumber);
        if (!selectedTrack) {
          throw new Error(`Audio track ${trackNumber} not found. Available tracks: ${audioTracks.map(t => t.index).join(', ')}`);
        }
        console.log(`Using specified track ${trackNumber}: ${selectedTrack.language || 'unknown language'}`);
      } else if (audioTracks.length === 1 || autoConfirm) {
        // Only one track or auto-confirm enabled
        selectedTrack = audioTracks[0];
        console.log(`Using audio track ${selectedTrack.index}: ${selectedTrack.language || 'unknown language'}`);
      } else {
        // Multiple tracks - prompt user
        selectedTrack = await this._promptForAudioTrack(audioTracks);
      }

      debug(`Selected track: ${selectedTrack.index}`);

      // Step 3: Extract audio from video
      console.log('\nExtracting audio...');
      const audioPath = await this.videoProcessor.extractAudio(inputPath, selectedTrack.index);
      debug(`Audio extracted to: ${audioPath}`);

      // Step 4: Transcribe audio using Whisper API
      console.log('\nTranscribing audio (this may take a while)...');
      const transcriptionLanguage = language || selectedTrack.language;
      const transcription = await this.transcriber.transcribe(audioPath, {
        language: transcriptionLanguage
      });

      debug(`Transcription completed with ${transcription.segments.length} segments`);

      // Step 5: Generate subtitle files for each target language
      if (targetLanguages && targetLanguages.length > 0) {
        console.log('\nGenerating subtitles for multiple languages...');

        const generatedFiles = [];

        for (const targetLang of targetLanguages) {
          console.log(`\n--- Processing language: ${targetLang} ---`);

          let segmentsToWrite;
          let langOutputPath;

          // Determine output path with language code
          const parsedPath = path.parse(outputPath);
          langOutputPath = path.join(parsedPath.dir, `${parsedPath.name}.${targetLang}.srt`);

          // Check if this is the original language or needs translation
          const isOriginalLanguage = targetLang.toLowerCase() === (transcriptionLanguage || '').toLowerCase();

          if (isOriginalLanguage) {
            console.log(`Using original transcription for ${targetLang}`);
            segmentsToWrite = transcription.segments;
          } else {
            // Translate segments to target language
            console.log(`Translating to ${targetLang}...`);
            segmentsToWrite = await this.translator.translateSegments(
              transcription.segments,
              targetLang,
              transcriptionLanguage
            );
          }

          // Write subtitle file
          console.log(`Writing ${targetLang} subtitles...`);
          await this.subtitleWriter.writeSubtitles(langOutputPath, {
            ...transcription,
            segments: segmentsToWrite
          });

          generatedFiles.push({ language: targetLang, path: langOutputPath });
          console.log(`✓ Generated: ${path.basename(langOutputPath)}`);
        }

        // Print summary
        console.log('\n' + '='.repeat(60));
        console.log('Generated subtitle files:');
        generatedFiles.forEach(file => {
          console.log(`  ${file.language}: ${path.basename(file.path)}`);
        });
        console.log('='.repeat(60));

      } else {
        // Single language mode (original behavior)
        console.log('\nGenerating subtitle file...');
        await this.subtitleWriter.writeSubtitles(outputPath, transcription);
      }

      // Step 6: Cleanup temporary files
      debug('Cleaning up temporary files');
      await fs.remove(audioPath);

      debug('Subtitle generation complete');

    } catch (error) {
      debug('Error during subtitle generation:', error);
      throw error;
    }
  }

  async _promptForAudioTrack(audioTracks) {
    console.log('\nMultiple audio tracks found:');

    const choices = audioTracks.map(track => {
      const lang = track.language || 'unknown';
      const channels = track.channels ? `${track.channels}ch` : '';
      const codec = track.codec || '';
      const details = [lang, codec, channels].filter(Boolean).join(', ');

      return {
        name: `Track ${track.index}: ${details}`,
        value: track,
        short: `Track ${track.index}`
      };
    });

    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'track',
        message: 'Which audio track would you like to transcribe?',
        choices: choices
      }
    ]);

    return answer.track;
  }
}

module.exports = SubtitleGenerator;
