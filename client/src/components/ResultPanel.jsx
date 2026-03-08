import { useState, useCallback } from 'react';
import api from '../api';

/**
 * Language code to display name mapping.
 */
const LANGUAGE_NAMES = {
  auto: 'Auto-detect',
  en: 'English',
  ja: 'Japanese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  zh: 'Chinese',
  ko: 'Korean',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
  nl: 'Dutch',
  pl: 'Polish',
  sv: 'Swedish',
  tr: 'Turkish',
  th: 'Thai',
  vi: 'Vietnamese'
};

function getLangName(code) {
  return LANGUAGE_NAMES[code] || code.toUpperCase();
}

/**
 * Single download button component.
 */
function DownloadButton({ jobId, language, format, label }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleDownload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getSubtitleUrl(jobId, language, format);
      // Open the download URL
      if (result.url) {
        window.open(result.url, '_blank');
      }
    } catch (err) {
      setError(err.message || 'Download failed');
    } finally {
      setLoading(false);
    }
  }, [jobId, language, format]);

  return (
    <div>
      <button
        onClick={handleDownload}
        disabled={loading}
        className="btn-secondary w-full justify-start gap-3 !px-4 !py-3"
      >
        {loading ? (
          <svg className="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
          <svg className="h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        )}
        <div className="text-left">
          <div className="text-sm font-semibold text-gray-900">
            {label}
          </div>
          <div className="text-xs text-gray-500">
            .{format} file
          </div>
        </div>
      </button>
      {error && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}

/**
 * ResultPanel -- displayed when a job completes successfully.
 * Shows download buttons for each language and format.
 */
export default function ResultPanel({ job, onReset }) {
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

  return (
    <div className="flex flex-col items-center">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg className="h-8 w-8 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <h1 className="mb-2 text-2xl font-bold text-gray-900">
          Subtitles Ready
        </h1>
        <p className="text-sm text-gray-500">
          Your subtitles have been generated successfully. Download them below.
        </p>
      </div>

      {/* Downloads card */}
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        {/* Download sections per language */}
        {languages.map((lang, index) => (
          <div key={lang} className={index > 0 ? 'mt-6 border-t border-gray-100 pt-6' : ''}>
            {languages.length > 1 && (
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                {getLangName(lang)}
                {index > 0 && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    translation
                  </span>
                )}
              </h3>
            )}

            <div className="grid grid-cols-2 gap-3">
              <DownloadButton
                jobId={job.id}
                language={lang}
                format="srt"
                label="Download SRT"
              />
              <DownloadButton
                jobId={job.id}
                language={lang}
                format="vtt"
                label="Download VTT"
              />
            </div>
          </div>
        ))}

        {/* Job info */}
        {job && (
          <div className="mt-6 rounded-lg bg-gray-50 px-4 py-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
              {job.audio_seconds && (
                <span>Duration: {Math.ceil(job.audio_seconds / 60)} min</span>
              )}
              {job.minutes_charged && (
                <span>Credits used: {job.minutes_charged} min</span>
              )}
              {job.cached_hit && (
                <span className="text-green-600">Served from cache</span>
              )}
            </div>
          </div>
        )}

        {/* Generate another */}
        <div className="mt-6">
          <button
            onClick={onReset}
            className="btn-secondary w-full"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            Generate Another
          </button>
        </div>
      </div>
    </div>
  );
}
