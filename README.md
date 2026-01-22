# Syncscribe 🎬

> AI-powered subtitle generation with automatic timing synchronization

Generate accurate subtitles for video files using state-of-the-art AI transcription. Perfect for creating subtitles when existing ones don't match the audio track (e.g., English dub with Japanese subtitle translations in anime).

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)](https://nodejs.org/)

## ✨ Features

- 🎯 **AI-Powered Transcription** - Uses OpenAI's Whisper API for highly accurate speech-to-text
- 🔄 **Automatic Timing Sync** - Integrates ffsubsync to fix progressive timing drift
- 🌍 **Multi-Language Support** - Supports 99+ languages with automatic detection
- 🌐 **Multi-Language Translation** - Generate subtitles in multiple languages from single transcription
- 🎚️ **Multi-Track Handling** - Detects and processes multiple audio tracks
- 📝 **SRT Format Output** - Generates universally compatible subtitle files
- ⚡ **Batch Processing** - Process entire seasons with a single command
- 💰 **Cost-Effective** - ~$0.14 per 23-minute episode (transcription only)

## 📋 Table of Contents

- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Usage](#-usage)
- [Workflow](#-workflow)
- [Cost](#-cost)
- [Troubleshooting](#-troubleshooting)
- [Project Structure](#-project-structure)
- [Contributing](#-contributing)
- [License](#-license)

## 🔧 Prerequisites

- **Node.js** 16.x or higher ([Download](https://nodejs.org/))
- **Python 3.7+** with pip ([Download](https://www.python.org/downloads/))
- **OpenAI API Key** ([Get one here](https://platform.openai.com/api-keys))
- **FFmpeg** (automatically included via dependencies)

## 📦 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/syncscribe.git
cd syncscribe
```

### 2. Install Node Dependencies

```bash
npm install
```

### 3. Install Python Dependencies

```bash
pip install ffsubsync
```

### 4. Configure Environment Variables

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:

```env
OPENAI_API_KEY=sk-your-actual-api-key-here
```

## 🚀 Quick Start

### Process a Single Video

```bash
node generate-and-sync.js -i "path/to/video.mkv"
```

This will:
1. Extract audio from the video
2. Transcribe using Whisper API
3. Sync timestamps with ffsubsync
4. Generate `video.srt` subtitle file

### Generate Subtitles in Multiple Languages

```bash
node app.js -i "path/to/video.mkv" --languages en,es,fr --auto
```

This will:
1. Extract audio from the video
2. Transcribe using Whisper API
3. Translate to each target language
4. Generate `video.en.srt`, `video.es.srt`, `video.fr.srt`

### Process Multiple Videos

```bash
# Extract audio from all videos first
npm run extract:src

# Then process each video
for file in src/**/*.mkv; do
  node generate-and-sync.js -i "$file"
done
```

## 💡 Usage

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run extract:src` | Extract audio from all videos in `./src` directory |
| `node generate-and-sync.js -i "video.mkv"` | Complete pipeline: extract → transcribe → sync |
| `node shift-timing.js "subtitle.srt" 3` | Manually shift subtitle timing by 3 seconds |

### Command Options

```bash
# Specify language (default: en)
node generate-and-sync.js -i "video.mkv" -l ja

# Generate subtitles in multiple languages
node app.js -i "video.mkv" --languages en,es,ja --auto

# Skip synchronization (use raw Whisper timestamps)
node generate-and-sync.js -i "video.mkv" --skip-sync

# Enable debug logging
node generate-and-sync.js -i "video.mkv" --debug
```

### Supported Languages

Whisper supports 99+ languages including:

| Language | Code | Language | Code |
|----------|------|----------|------|
| English | `en` | Japanese | `ja` |
| Spanish | `es` | French | `fr` |
| German | `de` | Italian | `it` |
| Portuguese | `pt` | Chinese | `zh` |
| Korean | `ko` | Russian | `ru` |

[View full language list](https://github.com/openai/whisper#available-models-and-languages)

### Supported Video Formats

Any format supported by FFmpeg:
- `.mkv` (Matroska)
- `.mp4` (MPEG-4)
- `.avi` (AVI)
- `.mov` (QuickTime)
- `.webm` (WebM)
- And many more...

## 🔄 Workflow

### The Complete Pipeline

```
┌─────────────────┐
│  Video File     │
│  (.mkv, .mp4)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  1. Extract     │  ← FFmpeg (local, free)
│     Audio       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  2. Transcribe  │  ← OpenAI Whisper API (~$0.14)
│     with AI     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  3. Sync        │  ← ffsubsync (local, free)
│     Timing      │    Fixes timing drift
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  4. Translate   │  ← OpenAI API (optional)
│  (Optional)     │    Generate multiple languages
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Subtitle Files │
│  (.srt)         │
└─────────────────┘
```

### Why Synchronization?

AI-generated timestamps from Whisper can drift over time, especially during:
- Long musical sequences (opening themes)
- Multiple overlapping voices
- Background noise/action scenes

**ffsubsync** uses spectral analysis to automatically correct these timing issues by comparing the audio waveform with the subtitle timing.

**Results from testing:**
- Episode with 0.14s drift → Perfect sync after ffsubsync
- Episode with 3s drift → Corrected to 0.01s accuracy
- Sync scores: 17,000-55,000 (higher = better alignment)

## 💰 Cost

### OpenAI Whisper API Pricing (Transcription)

- **Rate:** $0.006 per minute of audio
- **Examples:**
  - 23-minute anime episode: ~$0.14
  - 45-minute TV show: ~$0.27
  - 90-minute movie: ~$0.54
  - Full 10-hour season: ~$3.60

### OpenAI Translation Pricing (Optional)

When using `--languages` to generate multiple translations:

- **Model:** GPT-4o-mini
- **Rate:** ~$0.0008 per language for a 23-minute episode (~500 subtitle segments)
- **Examples:**
  - Single episode (en + es): ~$0.14 (transcription) + $0.0008 (translation) ≈ **$0.14**
  - Single episode (en + es + fr + de): ~$0.14 + $0.0024 ≈ **$0.14**
  - Translation is extremely cheap compared to transcription!

### What's Free?

- ✅ Audio extraction (FFmpeg - local)
- ✅ Timing synchronization (ffsubsync - local)
- ✅ All processing except OpenAI API calls

## 🛠️ Troubleshooting

### "OPENAI_API_KEY not found"

**Solution:** Ensure you've created a `.env` file with your API key.

```bash
cp .env.example .env
# Edit .env and add your key
```

### "ffsubsync not found"

**Solution:** Install ffsubsync using pip.

```bash
pip install ffsubsync
```

### "Audio file exceeds 25 MB limit"

**Solution:** Whisper API has a 25MB file size limit. For longer videos:
- The tool automatically compresses to 64kbps mono MP3
- If still too large, split the video into segments

### Subtitles still out of sync

**Solution:** Use the manual timing shift tool.

```bash
# Shift forward by 3 seconds
node shift-timing.js "subtitle.srt" 3

# Shift backward by 2 seconds
node shift-timing.js "subtitle.srt" -2
```

### Poor transcription quality

**Solutions:**
- Specify the language explicitly: `--language en`
- Ensure the audio quality is clear
- Check that you're using the correct audio track

### Enable debug mode

```bash
node generate-and-sync.js -i "video.mkv" --debug
```

## 📁 Project Structure

```
syncscribe/
├── app.js                      # Main CLI entry point
├── generate-and-sync.js        # Complete pipeline orchestrator
├── extract-audio.js            # Batch audio extraction tool
├── shift-timing.js             # Manual timing adjustment tool
├── sync-subtitles.js           # ffsubsync wrapper
├── lib/
│   ├── SubtitleGenerator.js    # Main orchestrator class
│   ├── VideoProcessor.js       # FFmpeg operations
│   ├── AudioAnalyzer.js        # Audio track detection
│   ├── Transcriber.js          # OpenAI Whisper API client
│   ├── Translator.js           # OpenAI translation service
│   └── SubtitleWriter.js       # SRT file generation
├── tmp/                        # Temporary files (gitignored)
├── output/                     # Output directory (gitignored)
├── src/                        # Your video files (gitignored)
├── .env                        # Your API keys (gitignored)
├── .env.example                # Environment template
├── package.json                # Node dependencies
├── USAGE.md                    # Quick reference guide
└── README.md                   # This file
```

## 🎯 Use Cases

### Anime with Mismatched Subtitles

**Problem:** You have English-dubbed anime, but the subtitles are translated from Japanese audio.

**Solution:**
```bash
node generate-and-sync.js -i "anime-episode.mkv" -l en
```

Result: Subtitles that match the English dub perfectly!

### Foreign Language Content

**Problem:** Video has multiple audio tracks, need subtitles for specific track.

**Solution:**
```bash
# The tool will prompt you to select which audio track to use
node generate-and-sync.js -i "movie.mkv"
```

### Batch Processing TV Series

**Problem:** Need subtitles for an entire season.

**Solution:**
```bash
# 1. Extract all audio files first
npm run extract:src

# 2. Process all episodes
for file in src/Season1/*.mkv; do
  node generate-and-sync.js -i "$file"
done
```

### Multi-Language Subtitles

**Problem:** Need subtitles in multiple languages for international distribution.

**Solution:**
```bash
# Generate English, Spanish, and French subtitles from one transcription
node app.js -i "video.mkv" --languages en,es,fr --auto
```

**Output:**
- `video.en.srt` - English subtitles
- `video.es.srt` - Spanish subtitles
- `video.fr.srt` - French subtitles

**Benefits:**
- Single transcription, multiple languages
- Same timing windows across all languages
- Minimal additional cost (~$0.001 per language)
- Perfect for content creators, educators, and international releases

## 🏗️ Architecture

This project follows a modular, service-based architecture inspired by professional Node.js applications:

- **Services** - Each functionality is a self-contained class
- **Orchestrator** - Main generator coordinates all services
- **CLI Tools** - Simple command-line interfaces for each operation
- **Error Handling** - Comprehensive error messages and validation

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

### Development Setup

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the ISC License - see the LICENSE file for details.

## 🙏 Acknowledgments

- [OpenAI Whisper](https://openai.com/research/whisper) - AI transcription
- [ffsubsync](https://github.com/smacke/ffsubsync) - Subtitle synchronization
- [FFmpeg](https://ffmpeg.org/) - Audio/video processing
- Inspired by the need for accurate English dub subtitles in anime

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/yourusername/syncscribe/issues)
- **Documentation:** See [USAGE.md](USAGE.md) for quick reference

---

**Made with ❤️ for anime fans and subtitle enthusiasts**
