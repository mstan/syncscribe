# Syncscribe - Quick Usage Guide

## 🚀 Simple Workflow

### Process One Episode

```bash
node generate-and-sync.js -i "src/Pokemon Season 7/Pokemon 07x45 Sky High Gym Battle!.mkv"
```

This automatically:
1. ✅ Extracts audio (skips if already exists)
2. ✅ Transcribes with Whisper API (~$0.14)
3. ✅ Syncs to video with ffsubsync (fixes timing drift)
4. ✅ Outputs: `Pokemon 07x45 Sky High Gym Battle!.srt`

### Process All Episodes

```bash
cd F:/Projects/subtitles

for file in "src/Pokemon Season 7"/*.mkv; do
  node generate-and-sync.js -i "$file"
done
```

Cost: ~$0.14 per episode

## 📝 Available Commands

| Command | Description |
|---------|-------------|
| `npm run extract:src` | Extract audio from all videos in `/src` |
| `npm run generate` | Alias for generate-and-sync.js |
| `node generate-and-sync.js -i "video.mkv"` | Complete pipeline for one file |
| `node shift-timing.js "file.srt" 3` | Manually shift subtitle timing by 3 seconds |

## 🎯 Command Options

```bash
# Specify language (default: en)
node generate-and-sync.js -i "video.mkv" -l ja

# Skip sync step (use raw Whisper timestamps)
node generate-and-sync.js -i "video.mkv" --skip-sync
```

## 📊 Quality Results

Based on Pokemon Season 7 testing:
- **Episode 42**: ffsubsync score 17628, offset -0.140s
- **Episode 43**: ffsubsync score 46710, offset 0.000s (perfect!)
- **Episode 44**: ffsubsync score 54568, offset 0.010s (essentially perfect)

Higher scores = better alignment. Synced subtitles have excellent quality!

## 🔧 Troubleshooting

### "ffsubsync not found"
Install it once:
```bash
pip install ffsubsync
```

### "OPENAI_API_KEY not found"
Create `.env` file with your API key:
```bash
cp .env.example .env
# Edit .env and add: OPENAI_API_KEY=your_key_here
```

### Timing still off after sync
Use the manual shift tool:
```bash
node shift-timing.js "subtitle.srt" 3  # Shift forward 3 seconds
node shift-timing.js "subtitle.srt" -2 # Shift backward 2 seconds
```

## 📁 File Structure

After processing, you'll have:
```
src/Pokemon Season 7/
  ├── Pokemon 07x42 A Shroomish Skirmish.mkv  (original video)
  ├── Pokemon 07x42 A Shroomish Skirmish.mp3  (extracted audio)
  └── Pokemon 07x42 A Shroomish Skirmish.srt  (synced subtitles)
```

The MP3 files are kept so you don't need to re-extract if you want to re-transcribe.

## 💰 Cost Breakdown

- **Audio extraction**: FREE (local FFmpeg)
- **Whisper transcription**: ~$0.14 per 23-min episode
- **ffsubsync**: FREE (local processing)

**Total per episode: ~$0.14**
