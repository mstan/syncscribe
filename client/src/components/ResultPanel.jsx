import { useState, useCallback, useRef } from 'react';
import api from '../api';

import { getLangName, getIso3 } from '../../../shared/languages.js';

/**
 * Single download button component.
 */
function DownloadButton({ jobId, language, format, label, shared = false, primary = false }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleDownload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = shared
        ? await api.getSharedSubtitleUrl(jobId, language, format)
        : await api.getSubtitleUrl(jobId, language, format);
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (err) {
      setError(err.message || 'Download failed');
    } finally {
      setLoading(false);
    }
  }, [jobId, language, format, shared]);

  if (primary) {
    return (
      <div>
        <button
          onClick={handleDownload}
          disabled={loading}
          className="btn-primary w-full justify-center gap-2.5 !py-3.5 text-base"
        >
          {loading ? (
            <svg className="h-5 w-5 animate-spin text-white/60" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          )}
          <span className="font-semibold">{label}</span>
        </button>
        {error && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={handleDownload}
        disabled={loading}
        className="btn-secondary w-full justify-start gap-3 !px-4 !py-3"
      >
        {loading ? (
          <svg className="h-5 w-5 animate-spin text-stone-400 dark:text-stone-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
          <svg className="h-5 w-5 text-stone-400 dark:text-stone-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        )}
        <div className="text-left">
          <div className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {label}
          </div>
          <div className="text-xs text-stone-500 dark:text-stone-400">
            .{format} file
          </div>
        </div>
      </button>
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

/**
 * Small VTT download link shown beneath the SRT button.
 */
function VttLink({ jobId, language, shared = false }) {
  const [loading, setLoading] = useState(false);

  const handleDownload = useCallback(async () => {
    setLoading(true);
    try {
      const result = shared
        ? await api.getSharedSubtitleUrl(jobId, language, 'vtt')
        : await api.getSubtitleUrl(jobId, language, 'vtt');
      if (result.url) window.location.href = result.url;
    } catch {} finally {
      setLoading(false);
    }
  }, [jobId, language, shared]);

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="mt-1.5 text-xs text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 transition-colors"
    >
      {loading ? 'Downloading...' : 'Also available as .vtt (WebVTT)'}
    </button>
  );
}

/**
 * Spinner icon reusable SVG.
 */
function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

/**
 * Fetch subtitle text content via server proxy (avoids R2 CORS issues).
 */
async function fetchSubtitleText(jobId, language, format, shared = false) {
  return shared
    ? api.getSharedSubtitleContent(jobId, language, format)
    : api.getSubtitleContent(jobId, language, format);
}

/**
 * Trigger a browser download from a Blob.
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Count existing subtitle streams by parsing ffmpeg log output.
 */
function countExistingSubStreams(logs) {
  let count = 0;
  for (const line of logs) {
    if (/Output #|Stream mapping:/.test(line)) break;
    if (/Stream #0:\d+.*: Subtitle:/.test(line)) count++;
  }
  return count;
}

/**
 * ResultPanel -- displayed when a job completes successfully.
 * Shows download buttons for each language and format,
 * plus Download All (zip) and Embed Subtitles in Video.
 */
export default function ResultPanel({ job, onReset, fileName, thumbnailUrl, file, shared = false, expiresAt }) {
  const [downloadAllLoading, setDownloadAllLoading] = useState(false);
  const [downloadAllError, setDownloadAllError] = useState(null);
  const [embedState, setEmbedState] = useState('idle'); // idle | loading | embedding | done | error
  const [embedProgress, setEmbedProgress] = useState(0);
  const [embedMessage, setEmbedMessage] = useState('');
  const [embedError, setEmbedError] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const filePickerRef = useRef(null);
  const embedFileRef = useRef(file);
  embedFileRef.current = file;

  // Build the list of languages that have results
  const languages = [];
  if (job?.language) {
    languages.push(job.language);
  }
  if (job?.additional_languages?.length) {
    languages.push(...job.additional_languages);
  }

  // If no languages found, show a single "auto" language
  if (languages.length === 0) {
    languages.push('auto');
  }

  const baseName = fileName?.replace(/\.[^.]+$/, '') || 'subtitles';

  /**
   * Download All -- zip all SRT/VTT files and trigger download.
   */
  const handleDownloadAll = useCallback(async () => {
    setDownloadAllLoading(true);
    setDownloadAllError(null);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Fetch all subtitle files in parallel
      const fetches = [];
      for (const lang of languages) {
        for (const fmt of ['srt', 'vtt']) {
          fetches.push(
            fetchSubtitleText(job.id, lang, fmt, shared).then(text => {
              zip.file(`${baseName}.${lang}.${fmt}`, text);
            })
          );
        }
      }
      await Promise.all(fetches);

      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `${baseName}-subtitles.zip`);
    } catch (err) {
      console.error('Download All failed:', err);
      setDownloadAllError(err.message || 'Failed to create zip');
    } finally {
      setDownloadAllLoading(false);
    }
  }, [job?.id, languages, baseName]);

  /**
   * Embed Subtitles in Video -- mux SRT tracks into an MKV container client-side.
   * Preserves all original streams (video, audio, existing subs) and appends
   * our generated SRT tracks with correct language metadata.
   */
  const handleEmbed = useCallback(async (pickedFile) => {
    const videoFile = pickedFile || embedFileRef.current;

    // If no file available, open file picker
    if (!videoFile) {
      filePickerRef.current?.click();
      return;
    }

    setEmbedState('loading');
    setEmbedProgress(0);
    setEmbedMessage('Loading video processor...');
    setEmbedError(null);

    try {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { fetchFile } = await import('@ffmpeg/util');

      const ffmpeg = new FFmpeg();
      const probeLogs = [];

      ffmpeg.on('progress', ({ progress: p }) => {
        setEmbedProgress(Math.min(Math.round(p * 100), 100));
      });

      ffmpeg.on('log', ({ message }) => {
        probeLogs.push(message);
        console.debug('[ffmpeg:embed]', message);
      });

      await ffmpeg.load({
        coreURL: '/ffmpeg/ffmpeg-core.js',
        wasmURL: '/ffmpeg/ffmpeg-core.wasm'
      });

      setEmbedState('embedding');
      setEmbedMessage('Reading video file...');
      setEmbedProgress(0);

      // Write original video to virtual FS
      const inputExt = videoFile.name.substring(videoFile.name.lastIndexOf('.'));
      const inputName = `input${inputExt}`;
      await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

      // Probe the file to count existing subtitle streams
      setEmbedMessage('Analyzing video...');
      probeLogs.length = 0;
      await ffmpeg.exec(['-i', inputName, '-f', 'null', '-']);
      const existingSubCount = countExistingSubStreams(probeLogs);

      // Fetch all SRT files and write to virtual FS
      setEmbedMessage('Fetching subtitle files...');
      const srtFiles = [];
      for (const lang of languages) {
        const srtName = `${lang}.srt`;
        const text = await fetchSubtitleText(job.id, lang, 'srt', shared);
        await ffmpeg.writeFile(srtName, new TextEncoder().encode(text));
        srtFiles.push({ name: srtName, lang });
      }

      // Build ffmpeg command
      setEmbedMessage('Embedding subtitles...');
      probeLogs.length = 0;
      const args = ['-i', inputName];

      // Add each SRT as input
      for (const srt of srtFiles) {
        args.push('-i', srt.name);
      }

      // Map ALL original streams (preserves video, audio, existing subs)
      args.push('-map', '0');
      // Map each of our new SRT inputs
      for (let i = 0; i < srtFiles.length; i++) {
        args.push('-map', `${i + 1}`);
      }

      // Copy all codecs (no re-encoding)
      args.push('-c', 'copy');

      // Set language + title metadata for our new subtitle tracks,
      // offset by the number of existing subtitle streams
      for (let i = 0; i < srtFiles.length; i++) {
        const idx = existingSubCount + i;
        const iso3 = getIso3(srtFiles[i].lang);
        const langName = getLangName(srtFiles[i].lang);
        args.push(
          `-metadata:s:s:${idx}`, `language=${iso3}`,
          `-metadata:s:s:${idx}`, `title=${langName}`
        );
      }

      args.push('output.mkv');

      const exitCode = await ffmpeg.exec(args);

      if (exitCode !== 0) {
        throw new Error('FFmpeg failed to embed subtitles. Try a different video format.');
      }

      // Read output and trigger download
      setEmbedMessage('Preparing download...');
      const outputData = await ffmpeg.readFile('output.mkv');
      const blob = new Blob([outputData.buffer], { type: 'video/x-matroska' });
      downloadBlob(blob, `${baseName}.mkv`);

      // Cleanup virtual FS
      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile('output.mkv');
        for (const srt of srtFiles) {
          await ffmpeg.deleteFile(srt.name);
        }
      } catch {}

      setEmbedState('done');
      setEmbedMessage('');
    } catch (err) {
      console.error('Embed failed:', err);
      setEmbedState('error');
      setEmbedError(
        err.message?.includes('SharedArrayBuffer')
          ? 'Embedding requires a modern browser with SharedArrayBuffer support.'
          : err.message || 'Failed to embed subtitles'
      );
    }
  }, [job?.id, languages, baseName]);

  /**
   * Handle file picker for embed when original file is unavailable.
   */
  const handleEmbedFilePick = useCallback((e) => {
    const picked = e.target.files?.[0];
    if (picked) handleEmbed(picked);
    if (filePickerRef.current) filePickerRef.current.value = '';
  }, [handleEmbed]);

  return (
    <div className="flex flex-col items-center">
      {/* Header */}
      <div className="mb-8 text-center">
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt=""
            className="mx-auto mb-4 h-44 w-auto rounded-xl border border-stone-200 shadow-lg dark:border-stone-700"
          />
        )}
        <h1 className="mb-2 flex items-center justify-center gap-2 text-2xl font-bold text-stone-900 dark:text-stone-100">
          <svg className="h-6 w-6 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          Subtitles Ready
        </h1>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          {job?.audio_seconds
            ? <>
                {Math.ceil(job.audio_seconds / 60)} min duration
                {!shared && job?.minutes_charged && <> &middot; {job.minutes_charged} credits used</>}
              </>
            : 'Your subtitles have been generated successfully.'
          }
        </p>
      </div>

      {/* Downloads card */}
      <div className="w-full max-w-2xl rounded-2xl border border-stone-200 bg-white p-8 shadow-sm dark:border-stone-700 dark:bg-stone-900">

        {/* Embed progress overlay */}
        {(embedState === 'loading' || embedState === 'embedding') ? (
          <div className="mb-6 rounded-xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-800 dark:bg-brand-950">
            <div className="mb-3 flex items-center gap-2">
              <Spinner className="h-4 w-4 text-brand-600" />
              <span className="text-sm font-medium text-brand-700 dark:text-brand-300">
                {embedMessage}
              </span>
            </div>
            {embedState === 'embedding' && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-brand-100 dark:bg-brand-900">
                <div
                  className="h-full rounded-full bg-brand-600 transition-all duration-300 ease-out"
                  style={{ width: `${embedProgress}%` }}
                />
              </div>
            )}
          </div>
        ) : embedState === 'error' ? (
          <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 dark:bg-red-950">
            <p className="text-xs text-red-600 dark:text-red-400">{embedError}</p>
            <button
              onClick={() => setEmbedState('idle')}
              className="mt-2 text-xs font-medium text-red-700 underline dark:text-red-300"
            >
              Dismiss
            </button>
          </div>
        ) : embedState === 'done' ? (
          <div className="mb-6 rounded-lg bg-green-50 px-4 py-3 dark:bg-green-950">
            <p className="text-xs text-green-700 dark:text-green-400">
              MKV with embedded subtitles downloaded successfully.
            </p>
            <button
              onClick={() => setEmbedState('idle')}
              className="mt-2 text-xs font-medium text-green-700 underline dark:text-green-300"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {/* Primary download action */}
        {(embedState === 'idle' || embedState === 'done' || embedState === 'error') && (
          <div className="mb-6">
            {languages.length > 1 ? (
              <>
                <button
                  onClick={handleDownloadAll}
                  disabled={downloadAllLoading}
                  className="btn-primary w-full justify-center gap-2.5 !py-3.5 text-base"
                >
                  {downloadAllLoading ? (
                    <Spinner className="h-5 w-5 text-white/60" />
                  ) : (
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  )}
                  <span className="font-semibold">Download All Subtitles</span>
                </button>
                {downloadAllError && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">{downloadAllError}</p>
                )}
              </>
            ) : (
              <>
                <DownloadButton
                  jobId={job.id}
                  language={languages[0]}
                  format="srt"
                  label="Download SRT"
                  shared={shared}
                  primary
                />
                <VttLink jobId={job.id} language={languages[0]} shared={shared} />
              </>
            )}
          </div>
        )}

        {/* Per-language individual downloads (multi-lang only) */}
        {languages.length > 1 && (
          <div className="mb-6 border-t border-stone-200 pt-6 dark:border-stone-700">
            {languages.map((lang, index) => (
              <div key={lang} className={index > 0 ? 'mt-4 border-t border-stone-100 pt-4 dark:border-stone-800' : ''}>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-700 dark:text-stone-300">
                  {getLangName(lang)}
                  {index > 0 && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-400">
                      translation
                    </span>
                  )}
                </h3>
                <div>
                  <DownloadButton
                    jobId={job.id}
                    language={lang}
                    format="srt"
                    label="Download SRT"
                    shared={shared}
                  />
                  <VttLink jobId={job.id} language={lang} shared={shared} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Embed Subtitles section */}
        {!shared && (embedState === 'idle' || embedState === 'done' || embedState === 'error') && (
          <div className="border-t border-stone-200 pt-6 dark:border-stone-700">
            <button
              onClick={() => handleEmbed()}
              disabled={embedState === 'loading' || embedState === 'embedding'}
              className="btn-secondary w-full justify-center gap-2.5 !py-3"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                <line x1="7" y1="2" x2="7" y2="22" />
                <line x1="17" y1="2" x2="17" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <line x1="2" y1="7" x2="7" y2="7" />
                <line x1="2" y1="17" x2="7" y2="17" />
                <line x1="17" y1="7" x2="22" y2="7" />
                <line x1="17" y1="17" x2="22" y2="17" />
              </svg>
              <span>{file ? 'Embed Subtitles in Video' : 'Embed Subtitles in Video...'}</span>
            </button>
            {!file && embedState === 'idle' && (
              <p className="mt-2 text-center text-xs text-stone-400 dark:text-stone-500">
                Embed will prompt you to re-select your video file.
              </p>
            )}
          </div>
        )}

        {/* Hidden file picker for embed fallback */}
        {!shared && (
          <input
            ref={filePickerRef}
            type="file"
            accept=".mkv,.mp4,.avi,.mov,.webm,.flv,.wmv,.m4v"
            onChange={handleEmbedFilePick}
            className="hidden"
          />
        )}

        {/* Share row */}
        <div className="mt-6 border-t border-stone-200 pt-4 dark:border-stone-700">
          {shared ? (
            <div className="flex items-center gap-2.5 px-3 py-2">
              <svg className="h-4 w-4 flex-shrink-0 text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <p className="text-xs text-brand-700 dark:text-brand-300">
                This shared link expires on {new Date(expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-3 py-2">
              <svg className="h-4 w-4 flex-shrink-0 text-stone-400 dark:text-stone-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              <p className="flex-1 text-xs text-stone-500 dark:text-stone-400">
                Share these subtitles &mdash; link valid for 7 days
              </p>
              <button
                onClick={() => {
                  const url = `${window.location.origin}/job/${job.id}`;
                  navigator.clipboard.writeText(url).then(() => {
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 2000);
                  });
                }}
                className="flex-shrink-0 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700"
              >
                {linkCopied ? 'Copied!' : 'Copy Link'}
              </button>
            </div>
          )}
        </div>

        {/* AI disclaimer */}
        <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
          AI-generated subtitles may contain minor errors. Review before distributing.
        </p>

        {/* Generate Another / Go to SyncScribe */}
        <div className="mt-6">
          <button
            onClick={onReset}
            className="btn-ghost w-full"
          >
            {shared ? (
              <>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                Go to SyncScribe
              </>
            ) : (
              <>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                Generate Another
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
