import { useState, useRef, useCallback } from 'react';
import langConfig from '../../../shared/languages.js';
const { ISO639_2_NAMES, ISO639_2_TO_1 } = langConfig;

/**
 * Accepted file extensions and MIME types (video + audio).
 */
const ACCEPT_EXTENSIONS = [
  '.mkv', '.mp4', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v',
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus'
];
const ACCEPT_MIMETYPES = [
  'video/mp4', 'video/x-matroska', 'video/avi', 'video/x-msvideo',
  'video/quicktime', 'video/webm', 'video/x-flv', 'video/x-ms-wmv',
  'video/x-m4v',
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/aac',
  'audio/ogg', 'audio/x-m4a', 'audio/mp4', 'audio/x-ms-wma', 'audio/opus'
];

/**
 * Check if a file is an accepted video type.
 */
function isAcceptedFile(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (ACCEPT_EXTENSIONS.includes(ext)) return true;
  if (ACCEPT_MIMETYPES.includes(file.type)) return true;
  return false;
}

/**
 * Compute SHA-256 hash of an ArrayBuffer using Web Crypto API.
 */
async function computeSHA256(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parse actual duration from ffmpeg log output.
 * Matches lines like: Duration: 00:23:45.67, start: 0.000000, bitrate: ...
 */
function parseDuration(logs) {
  for (const line of logs) {
    const match = line.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (match) {
      return Math.round(
        parseInt(match[1]) * 3600
        + parseInt(match[2]) * 60
        + parseInt(match[3])
        + parseInt(match[4]) / 100
      );
    }
  }
  return null;
}

/**
 * Estimate audio duration from FLAC file size (fallback).
 * Used only when ffmpeg duration parsing fails.
 */
function estimateAudioSeconds(bufferSize) {
  // Raw PCM: 16kHz × 1ch × 2 bytes = 32KB/s; FLAC ~60% compression → ~19KB/s
  const bytesPerSecond = 19200;
  return Math.max(1, Math.round(bufferSize / bytesPerSecond));
}

/**
 * Extract the most useful error message from ffmpeg log lines.
 */
function extractFFmpegError(logs) {
  const errorLines = logs.filter(l =>
    /error|not found|invalid|unknown|unsupported|no such|does not contain|could not/i.test(l) &&
    !/hide_banner/i.test(l)
  );
  if (errorLines.length > 0) {
    return errorLines[errorLines.length - 1].trim();
  }
  return null;
}

/**
 * Parse ffmpeg log output for audio stream information.
 * Matches lines like: Stream #0:1(jpn): Audio: aac (LC), 48000 Hz, stereo, fltp
 */
function parseAudioTracks(logs) {
  const trackRegex = /Stream #0:(\d+)(?:\((\w+)\))?: Audio: (\w+)(?:\s*\([^)]*\))*,\s*(\d+)\s*Hz(?:,\s*([^,]+))?/;
  const tracks = [];
  let audioIndex = 0;

  for (const line of logs) {
    // Stop parsing when we reach the output section — streams listed after this
    // are our own extraction output, not input tracks.
    if (/Output #|Stream mapping:/.test(line)) break;

    const match = line.match(trackRegex);
    if (match) {
      tracks.push({
        streamIndex: parseInt(match[1]),
        audioIndex: audioIndex++,
        language: match[2] || null,
        codec: match[3],
        sampleRate: match[4],
        channels: match[5]?.trim() || null,
      });
    }
  }

  return tracks;
}

function getLanguageLabel(code) {
  if (!code) return null;
  return ISO639_2_NAMES[code.toLowerCase()] || code.toUpperCase();
}

/**
 * UploadDropzone states.
 */
const STATE = {
  IDLE: 'idle',
  EXTRACTING: 'extracting',
  TRACK_SELECT: 'track_select',
  ERROR: 'error'
};

/**
 * UploadDropzone -- the main file upload component.
 * Handles drag-and-drop, file selection, audio track detection, and ffmpeg.wasm audio extraction.
 *
 * Track detection works by capturing ffmpeg log output during the initial extraction
 * (ffmpeg logs stream info before processing). If multiple audio tracks are found,
 * the user is shown a track picker and can re-extract with a different track.
 */
export default function UploadDropzone({ isAuthenticated, onAuthRequired, onAudioExtracted }) {
  const [state, setState] = useState(STATE.IDLE);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState('');
  const [tracks, setTracks] = useState([]);
  const [selectedTrack, setSelectedTrack] = useState(0);
  const [previewUrls, setPreviewUrls] = useState({});
  const [previewLoading, setPreviewLoading] = useState(null);
  const [playingTrack, setPlayingTrack] = useState(null);
  const [thumbnailUrl, setThumbnailUrl] = useState(null);

  const fileInputRef = useRef(null);
  const ffmpegRef = useRef(null);
  const probeLogsRef = useRef(null);
  const inputNameRef = useRef(null);
  const fileNameRef = useRef('');
  const originalFileRef = useRef(null);
  const pendingAudioDataRef = useRef(null);
  const audioElRef = useRef(null);
  const tracksRef = useRef(null);

  /**
   * Initialize and return ffmpeg.wasm instance.
   */
  const getFFmpeg = useCallback(async () => {
    if (ffmpegRef.current) return ffmpegRef.current;

    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();

    ffmpeg.on('progress', ({ progress: p }) => {
      setProgress(Math.min(Math.round(p * 100), 100));
    });

    ffmpeg.on('log', ({ message }) => {
      if (probeLogsRef.current !== null) {
        probeLogsRef.current.push(message);
      }
      console.debug('[ffmpeg]', message);
    });

    setProgressMessage('Loading audio processor...');
    setProgress(0);

    await ffmpeg.load({
      coreURL: '/ffmpeg/ffmpeg-core.js',
      wasmURL: '/ffmpeg/ffmpeg-core.wasm'
    });

    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  }, []);

  /**
   * Re-extract audio with a specific track via -map.
   * Used when the user picks a non-default track from the track selector.
   */
  const extractAudio = useCallback(async (audioIndex) => {
    setState(STATE.EXTRACTING);
    setProgressMessage('Extracting audio...');
    setProgress(0);

    try {
      const ffmpeg = ffmpegRef.current;
      const inputName = inputNameRef.current;

      probeLogsRef.current = [];
      const exitCode = await ffmpeg.exec([
        '-i', inputName,
        '-map', `0:a:${audioIndex}`,
        '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k',
        'output.mp3'
      ]);
      const logs = [...probeLogsRef.current];
      probeLogsRef.current = null;

      if (exitCode !== 0) {
        const detail = extractFFmpegError(logs);
        try { await ffmpeg.deleteFile(inputName); } catch {}
        inputNameRef.current = null;
        setState(STATE.ERROR);
        setError(detail
          ? `FFmpeg error: ${detail}`
          : 'Audio extraction failed. The file may use an unsupported codec. Try converting to MP4 first.'
        );
        return;
      }

      // Read the output
      setProgressMessage('Preparing audio data...');
      const outputData = await ffmpeg.readFile('output.mp3');
      const audioBuffer = outputData.buffer;

      // Extract thumbnail before cleanup
      let thumbUrl = null;
      try {
        const thumbExit = await ffmpeg.exec([
          '-i', inputName,
          '-ss', '5',
          '-vframes', '1',
          '-vf', 'scale=320:-1',
          '-f', 'image2',
          'thumb.jpg'
        ]);
        if (thumbExit === 0) {
          const thumbData = await ffmpeg.readFile('thumb.jpg');
          thumbUrl = URL.createObjectURL(new Blob([thumbData.buffer], { type: 'image/jpeg' }));
          try { await ffmpeg.deleteFile('thumb.jpg'); } catch {}
        }
      } catch {}

      setThumbnailUrl(thumbUrl);

      // Cleanup virtual filesystem
      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile('output.mp3');
      } catch {
        // Non-critical cleanup error
      }
      inputNameRef.current = null;

      // Compute SHA-256
      setProgressMessage('Computing file hash...');
      const sha256 = await computeSHA256(audioBuffer);

      // Parse actual duration from ffmpeg logs, fall back to estimate
      const seconds = parseDuration(logs) || estimateAudioSeconds(audioBuffer.byteLength);

      // Look up track language from current tracks state via ref
      const selectedTrackInfo = tracksRef.current?.find(t => t.audioIndex === audioIndex);
      const trackLang = selectedTrackInfo?.language;
      const trackLanguage = trackLang ? (ISO639_2_TO_1[trackLang.toLowerCase()] || null) : null;

      // Pass data to parent
      onAudioExtracted({
        buffer: audioBuffer,
        sha256,
        seconds,
        fileName: fileNameRef.current,
        trackIndex: audioIndex,
        trackLanguage,
        thumbnailUrl: thumbUrl,
        file: originalFileRef.current
      });

    } catch (err) {
      console.error('Audio extraction failed:', err);
      setState(STATE.ERROR);
      setError(
        err.message?.includes('SharedArrayBuffer')
          ? 'Audio extraction requires a modern browser with SharedArrayBuffer support. Please use Chrome, Firefox, or Edge.'
          : `Audio extraction failed: ${err.message || 'Unknown error'}. Try converting to MP4 first.`
      );
    }
  }, [onAudioExtracted]);

  /**
   * Process a selected video file: extract audio (capturing logs for track detection).
   * If multiple audio tracks are found, shows the track selector before proceeding.
   */
  const processFile = useCallback(async (file) => {
    if (!isAuthenticated) {
      onAuthRequired();
      return;
    }

    if (!isAcceptedFile(file)) {
      setError(`Unsupported file type. Please use: ${ACCEPT_EXTENSIONS.join(', ')}`);
      return;
    }

    setError(null);
    setState(STATE.EXTRACTING);
    setFileName(file.name);
    fileNameRef.current = file.name;
    originalFileRef.current = file;
    setProgress(0);
    setTracks([]);
    setSelectedTrack(0);
    setThumbnailUrl(null);
    pendingAudioDataRef.current = null;

    try {
      // Load ffmpeg
      const ffmpeg = await getFFmpeg();

      // Write input file to ffmpeg virtual filesystem
      setProgressMessage('Reading video file...');
      const { fetchFile } = await import('@ffmpeg/util');
      const inputName = 'input' + file.name.substring(file.name.lastIndexOf('.'));
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      inputNameRef.current = inputName;

      // Extract audio (default track), capturing logs for track detection
      setProgressMessage('Extracting audio...');
      setProgress(0);
      probeLogsRef.current = [];

      const exitCode = await ffmpeg.exec([
        '-i', inputName,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'libmp3lame', '-b:a', '48k',
        'output.mp3'
      ]);

      // Capture logs and detect tracks
      const logs = [...probeLogsRef.current];
      probeLogsRef.current = null;

      if (exitCode !== 0) {
        const detail = extractFFmpegError(logs);
        try { await ffmpeg.deleteFile(inputName); } catch {}
        inputNameRef.current = null;
        setState(STATE.ERROR);
        setError(detail
          ? `FFmpeg error: ${detail}`
          : 'Audio extraction failed. The file may use an unsupported codec. Try converting to MP4 first.'
        );
        return;
      }

      const detectedTracks = parseAudioTracks(logs);

      // Read the extracted output
      setProgressMessage('Preparing audio data...');
      const outputData = await ffmpeg.readFile('output.mp3');
      const audioBuffer = outputData.buffer;

      // Delete output file (keep input in case of re-extraction)
      try { await ffmpeg.deleteFile('output.mp3'); } catch {}

      // Compute SHA-256
      setProgressMessage('Computing file hash...');
      const sha256 = await computeSHA256(audioBuffer);

      // Parse actual duration from ffmpeg logs, fall back to estimate
      const seconds = parseDuration(logs) || estimateAudioSeconds(audioBuffer.byteLength);

      // Map 3-letter track language to 2-letter code for the language selector
      const defaultTrackLang = detectedTracks[0]?.language;
      const trackLanguage = defaultTrackLang ? (ISO639_2_TO_1[defaultTrackLang.toLowerCase()] || null) : null;

      // Extract thumbnail
      let thumbUrl = null;
      try {
        const thumbExit = await ffmpeg.exec([
          '-i', inputName,
          '-ss', '5',
          '-vframes', '1',
          '-vf', 'scale=320:-1',
          '-f', 'image2',
          'thumb.jpg'
        ]);
        if (thumbExit === 0) {
          const thumbData = await ffmpeg.readFile('thumb.jpg');
          thumbUrl = URL.createObjectURL(new Blob([thumbData.buffer], { type: 'image/jpeg' }));
          try { await ffmpeg.deleteFile('thumb.jpg'); } catch {}
        }
      } catch {}

      setThumbnailUrl(thumbUrl);

      const audioResult = {
        buffer: audioBuffer,
        sha256,
        seconds,
        fileName: file.name,
        trackIndex: 0,
        trackLanguage,
        thumbnailUrl: thumbUrl,
        file
      };

      if (detectedTracks.length > 1) {
        // Multiple tracks found — save result and show track picker.
        // If user keeps track 0, we use this result. Otherwise re-extract.
        pendingAudioDataRef.current = audioResult;
        tracksRef.current = detectedTracks;
        setTracks(detectedTracks);
        setSelectedTrack(0);
        setState(STATE.TRACK_SELECT);
      } else {
        // Single track (or none detected) — clean up and pass to parent
        try { await ffmpeg.deleteFile(inputName); } catch {}
        inputNameRef.current = null;
        onAudioExtracted(audioResult);
      }

    } catch (err) {
      console.error('Audio extraction failed:', err);
      setState(STATE.ERROR);
      setError(
        err.message?.includes('SharedArrayBuffer')
          ? 'Audio extraction requires a modern browser with SharedArrayBuffer support. Please use Chrome, Firefox, or Edge.'
          : `Audio extraction failed: ${err.message || 'Unknown error'}. Try converting to MP4 first.`
      );
    }
  }, [isAuthenticated, onAuthRequired, getFFmpeg, onAudioExtracted]);

  /**
   * Handle file selection from the file input.
   */
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processFile]);

  /**
   * Handle drop event.
   */
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleClick = useCallback(() => {
    if (state === STATE.EXTRACTING) return;
    if (!isAuthenticated) {
      onAuthRequired();
      return;
    }
    fileInputRef.current?.click();
  }, [state, isAuthenticated, onAuthRequired]);

  /**
   * Clean up all preview blob URLs and audio element.
   */
  const cleanupPreviews = useCallback(() => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    setPlayingTrack(null);
    setPreviewLoading(null);
    setPreviewUrls(prev => {
      Object.values(prev).forEach(url => URL.revokeObjectURL(url));
      return {};
    });
  }, []);

  const handleRetry = useCallback(() => {
    cleanupPreviews();
    pendingAudioDataRef.current = null;
    inputNameRef.current = null;
    setState(STATE.IDLE);
    setError(null);
    setProgress(0);
    setFileName('');
    setTracks([]);
    setSelectedTrack(0);
    setThumbnailUrl(null);
  }, [cleanupPreviews]);

  /**
   * Called when user confirms track selection.
   * If they kept the default track (0), uses the already-extracted audio.
   * Otherwise, re-extracts with -map for the chosen track.
   */
  const handleTrackConfirm = useCallback(async () => {
    cleanupPreviews();
    if (selectedTrack === 0 && pendingAudioDataRef.current) {
      // Use the already-extracted default track
      const data = pendingAudioDataRef.current;
      pendingAudioDataRef.current = null;
      // Clean up input file
      if (inputNameRef.current && ffmpegRef.current) {
        try { await ffmpegRef.current.deleteFile(inputNameRef.current); } catch {}
        inputNameRef.current = null;
      }
      onAudioExtracted(data);
    } else {
      // Re-extract with the selected track
      pendingAudioDataRef.current = null;
      extractAudio(selectedTrack);
    }
  }, [selectedTrack, extractAudio, onAudioExtracted, cleanupPreviews]);

  /**
   * Called when user goes back from track selection.
   */
  const handleBackFromTrackSelect = useCallback(async () => {
    cleanupPreviews();
    pendingAudioDataRef.current = null;
    if (inputNameRef.current && ffmpegRef.current) {
      try { await ffmpegRef.current.deleteFile(inputNameRef.current); } catch {}
    }
    inputNameRef.current = null;
    setState(STATE.IDLE);
    setTracks([]);
    setSelectedTrack(0);
    setFileName('');
    setThumbnailUrl(null);
  }, [cleanupPreviews]);

  /**
   * Extract a short preview clip for a track and play/pause it.
   */
  const handlePreview = useCallback(async (audioIndex) => {
    // If already playing this track, toggle pause
    if (playingTrack === audioIndex && audioElRef.current) {
      audioElRef.current.pause();
      setPlayingTrack(null);
      return;
    }

    // Stop any current playback
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
      setPlayingTrack(null);
    }

    // If we already have a preview URL, just play it
    if (previewUrls[audioIndex]) {
      const audio = new Audio(previewUrls[audioIndex]);
      audio.volume = 1.0;
      audio.onended = () => setPlayingTrack(null);
      audioElRef.current = audio;
      setPlayingTrack(audioIndex);
      audio.play().catch(err => {
        console.error('Preview playback failed:', err);
        setPlayingTrack(null);
      });
      return;
    }

    // Extract a short preview clip
    if (!ffmpegRef.current || !inputNameRef.current) return;
    setPreviewLoading(audioIndex);

    try {
      const ffmpeg = ffmpegRef.current;
      const inputName = inputNameRef.current;
      const previewFile = `preview_${audioIndex}.wav`;

      probeLogsRef.current = [];
      const exitCode = await ffmpeg.exec([
        '-ss', '30',       // Fast seek before input
        '-i', inputName,
        '-map', `0:a:${audioIndex}`,
        '-t', '8',          // 8 second clip
        '-ac', '2',         // Stereo for preview
        '-ar', '44100',
        '-c:a', 'pcm_s16le',
        '-f', 'wav',
        previewFile
      ]);
      probeLogsRef.current = null;

      if (exitCode !== 0) {
        // If seeking to 30s failed (short file), try from the start
        probeLogsRef.current = [];
        const retryCode = await ffmpeg.exec([
          '-i', inputName,
          '-map', `0:a:${audioIndex}`,
          '-t', '8',
          '-ac', '2',
          '-ar', '44100',
          '-c:a', 'pcm_s16le',
          '-f', 'wav',
          previewFile
        ]);
        probeLogsRef.current = null;
        if (retryCode !== 0) {
          setPreviewLoading(null);
          return;
        }
      }

      const data = await ffmpeg.readFile(previewFile);
      try { await ffmpeg.deleteFile(previewFile); } catch {}

      const blob = new Blob([data.buffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);

      setPreviewUrls(prev => ({ ...prev, [audioIndex]: url }));
      setPreviewLoading(null);

      const audio = new Audio(url);
      audio.volume = 1.0;
      audio.onended = () => setPlayingTrack(null);
      audioElRef.current = audio;
      setPlayingTrack(audioIndex);
      audio.play().catch(err => {
        console.error('Preview playback failed:', err);
        setPlayingTrack(null);
      });
    } catch (err) {
      console.error('Preview extraction failed:', err);
      setPreviewLoading(null);
    }
  }, [playingTrack, previewUrls]);

  // ── Render: Extracting state ───────────────────────────────────────

  if (state === STATE.EXTRACTING) {
    return (
      <div className="flex flex-col items-center">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-2xl font-bold text-stone-900 dark:text-stone-100">
            Extracting Audio
          </h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Processing <span className="font-medium text-stone-700 dark:text-stone-300">{fileName}</span>
          </p>
        </div>

        {/* Progress card */}
        <div className="w-full max-w-2xl rounded-2xl border border-stone-200 bg-white p-8 shadow-sm dark:border-stone-700 dark:bg-stone-900">
          <div className="mb-4 flex items-center justify-between text-sm">
            <span className="font-medium text-stone-700 dark:text-stone-300">{progressMessage}</span>
            <span className="tabular-nums text-stone-500 dark:text-stone-400">{progress}%</span>
          </div>

          {/* Progress bar */}
          <div className="mb-6 h-2.5 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
            <div
              className="h-full rounded-full bg-brand-600 transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Privacy note */}
          <div className="flex items-start gap-2 rounded-lg bg-green-50 px-4 py-3 dark:bg-green-950">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <p className="text-xs text-green-700 dark:text-green-400">
              Audio is extracted locally in your browser. Only the audio track is uploaded -- never the full video.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Track selection state ──────────────────────────────────

  if (state === STATE.TRACK_SELECT) {
    return (
      <div className="flex flex-col items-center">
        {/* Header */}
        <div className="mb-8 text-center">
          <p className="mb-2 text-sm text-stone-500 dark:text-stone-400">
            <span className="font-medium text-stone-700 dark:text-stone-300">{fileName}</span>
          </p>
          {thumbnailUrl && (
            <img
              src={thumbnailUrl}
              alt=""
              className="mx-auto mb-4 h-44 w-auto rounded-xl border border-stone-200 shadow-lg dark:border-stone-700"
            />
          )}
          <h1 className="mb-2 text-2xl font-bold text-stone-900 dark:text-stone-100">
            Select Audio Track
          </h1>
        </div>

        {/* Track selector card */}
        <div className="w-full max-w-2xl rounded-2xl border border-stone-200 bg-white p-8 shadow-sm dark:border-stone-700 dark:bg-stone-900">
          <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
            Multiple audio tracks detected. Select which track to transcribe:
          </p>

          {/* Track list */}
          <div className="mb-6 space-y-2">
            {tracks.map((track) => {
              const isSelected = selectedTrack === track.audioIndex;
              const langLabel = getLanguageLabel(track.language);
              const isPlaying = playingTrack === track.audioIndex;
              const isLoading = previewLoading === track.audioIndex;
              return (
                <div
                  key={track.audioIndex}
                  className={`
                    flex items-center rounded-lg border transition-all duration-150
                    ${isSelected
                      ? 'border-brand-300 bg-brand-50 ring-2 ring-brand-500/20 dark:border-brand-700 dark:bg-brand-950'
                      : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-600 dark:hover:bg-stone-800'
                    }
                  `}
                >
                  {/* Selectable track info area */}
                  <button
                    onClick={() => setSelectedTrack(track.audioIndex)}
                    className="flex flex-1 items-center gap-3 p-4 text-left"
                  >
                    {/* Radio indicator */}
                    <div className={`
                      flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2
                      ${isSelected ? 'border-brand-600' : 'border-stone-300 dark:border-stone-600'}
                    `}>
                      {isSelected && (
                        <div className="h-2 w-2 rounded-full bg-brand-600" />
                      )}
                    </div>

                    {/* Track info */}
                    <div>
                      <span className="font-medium text-stone-900 dark:text-stone-100">
                        Track {track.audioIndex + 1}
                      </span>
                      {langLabel && (
                        <span className="ml-2 text-sm text-stone-700 dark:text-stone-300">
                          {langLabel}
                        </span>
                      )}
                      <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">
                        {track.codec.toUpperCase()}
                        {track.channels && `, ${track.channels}`}
                        {track.sampleRate && `, ${track.sampleRate} Hz`}
                      </span>
                    </div>
                  </button>

                  {/* Preview play button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePreview(track.audioIndex); }}
                    disabled={isLoading}
                    className="mr-3 flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
                    title={isPlaying ? 'Pause preview' : 'Preview track'}
                  >
                    {isLoading ? (
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : isPlaying ? (
                      <svg className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                      </svg>
                    ) : (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                    {isPlaying ? 'Pause' : 'Preview'}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button onClick={handleBackFromTrackSelect} className="btn-ghost">
              Back
            </button>
            <button
              onClick={handleTrackConfirm}
              className="btn-primary flex-1"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Error state ────────────────────────────────────────────

  if (state === STATE.ERROR) {
    return (
      <div className="flex flex-col items-center">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-2xl font-bold text-stone-900 dark:text-stone-100">
            Extraction Failed
          </h1>
        </div>

        <div className="w-full max-w-2xl rounded-2xl border border-red-200 bg-white p-8 shadow-sm dark:border-red-900 dark:bg-stone-900">
          <div className="mb-6 flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
              <svg className="h-5 w-5 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-stone-900 dark:text-stone-100">
                {fileName}
              </p>
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            </div>
          </div>

          <button
            onClick={handleRetry}
            className="btn-primary w-full"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Idle state (main dropzone) ─────────────────────────────

  return (
    <div className="flex flex-col items-center">
      {/* Hero text */}
      <div className="mb-8 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl dark:text-stone-100">
          AI Subtitle Generator
        </h1>
        <p className="mx-auto max-w-md text-base text-stone-500 dark:text-stone-400">
          Generate accurate subtitles for your media in minutes.
          Upload a video, get SRT and VTT files back.
        </p>
      </div>

      {/* Dropzone */}
      <div
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          group w-full max-w-xl cursor-pointer rounded-2xl border-2 border-dashed
          bg-white p-12 text-center shadow-sm
          transition-all duration-200
          dark:bg-stone-900
          ${dragOver
            ? 'border-brand-500 bg-brand-50 shadow-md scale-[1.01] dark:bg-brand-950'
            : 'border-stone-300 hover:border-brand-400 hover:bg-stone-50 hover:shadow-md dark:border-stone-600 dark:hover:border-brand-400 dark:hover:bg-stone-800'
          }
        `}
      >
        {/* Upload icon */}
        <div className={`
          mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl transition-colors duration-200
          ${dragOver ? 'bg-brand-100 dark:bg-brand-950' : 'bg-stone-100 group-hover:bg-brand-50 dark:bg-stone-800 dark:group-hover:bg-brand-950'}
        `}>
          <svg
            className={`h-8 w-8 transition-colors duration-200 ${dragOver ? 'text-brand-600' : 'text-stone-400 group-hover:text-brand-500 dark:text-stone-500'}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>

        <p className="mb-2 text-base font-semibold text-stone-700 dark:text-stone-300">
          {dragOver ? 'Drop your video file here' : 'Drop a video file or click to browse'}
        </p>
        <p className="mb-4 text-sm text-stone-400 dark:text-stone-500">
          Supports MKV, MP4, AVI, MOV, WebM, and more
        </p>

        {/* Privacy badge */}
        <div className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-400">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          Audio is extracted locally in your browser
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_EXTENSIONS.join(',')}
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Desktop note */}
      <p className="mt-4 text-xs text-stone-400 dark:text-stone-500">
        Best on desktop. Large files may take a moment to process.
      </p>
    </div>
  );
}
