import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useTheme from '../hooks/useTheme';
import api from '../api';
import ResultPanel from './ResultPanel';

export default function SharedResultPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { status, message }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.getSharedJob(jobId);
        if (!cancelled) setJob(data);
      } catch (err) {
        if (!cancelled) {
          setError({
            status: err.status || 0,
            message: err.status === 410
              ? 'This shared link has expired. Shared links are available for 7 days after the job is created.'
              : 'The subtitles you\'re looking for could not be found. The link may be invalid or the job may not be ready yet.'
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [jobId]);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Minimal header */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur-md dark:border-gray-700 dark:bg-gray-900/80">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2 text-lg font-bold text-gray-900 transition-colors hover:text-brand-600 dark:text-gray-100">
            <svg className="h-6 w-6 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            SyncScribe
            <span className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-600 dark:bg-brand-950 dark:text-brand-300">
              Beta
            </span>
          </a>
          <button
            onClick={toggle}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title={`Theme: ${theme}`}
          >
            {theme === 'dark' ? (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : theme === 'light' ? (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center">
        <div className="mx-auto w-full max-w-3xl px-4 py-8">
          {loading && (
            <div className="flex flex-col items-center py-20">
              <svg className="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading shared subtitles...</p>
            </div>
          )}

          {!loading && error && error.status === 410 && (
            <div className="flex flex-col items-center py-20">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
                <svg className="h-8 w-8 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">Link Expired</h1>
              <p className="mb-6 max-w-md text-center text-sm text-gray-500 dark:text-gray-400">{error.message}</p>
              <a href="/" className="btn-primary">Go to SyncScribe</a>
            </div>
          )}

          {!loading && error && error.status !== 410 && (
            <div className="flex flex-col items-center py-20">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                <svg className="h-8 w-8 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">Not Found</h1>
              <p className="mb-6 max-w-md text-center text-sm text-gray-500 dark:text-gray-400">{error.message}</p>
              <a href="/" className="btn-primary">Go to SyncScribe</a>
            </div>
          )}

          {!loading && !error && job && (
            <ResultPanel
              job={job}
              onReset={() => navigate('/')}
              fileName={null}
              thumbnailUrl={null}
              file={null}
              shared={true}
              expiresAt={job.expires_at}
            />
          )}
        </div>
      </main>

      <footer className="border-t border-gray-200 bg-white/60 backdrop-blur-sm dark:border-gray-700 dark:bg-gray-900/60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 py-5 text-sm text-gray-500 dark:text-gray-400">
          <a href="mailto:syncscribe@1379.tech" className="transition-colors hover:text-gray-700 dark:hover:text-gray-300">
            Support
          </a>
          <span className="hidden sm:inline text-gray-300 dark:text-gray-600">|</span>
          <a href="mailto:syncscribe@1379.tech?subject=API%20%2F%20Enterprise%20Inquiry" className="transition-colors hover:text-gray-700 dark:hover:text-gray-300">
            API / Enterprise
          </a>
        </div>
        <div className="border-t border-gray-100 py-3 text-center text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
          <p>SyncScribe Beta &mdash; AI-powered subtitle generation</p>
          <p className="mt-1">Subtitles are generated by AI and may contain errors. Please review before distributing.</p>
        </div>
      </footer>
    </div>
  );
}
