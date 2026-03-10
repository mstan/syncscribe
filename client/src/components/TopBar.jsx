import { useState, useRef, useEffect } from 'react';
import useTheme from '../hooks/useTheme';

/**
 * TopBar -- top navigation bar.
 * Shows logo on the left, and auth/credits controls on the right.
 */
export default function TopBar({ user, isAuthenticated, balance, onBuyCredits, onLogout, onSignIn }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const { theme, toggle } = useTheme();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/80 backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/80">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        {/* Logo / brand */}
        <a href="/" className="flex items-center gap-2 text-lg font-bold text-stone-900 transition-colors hover:text-brand-600 dark:text-stone-100">
          <svg className="h-6 w-6 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          SyncScribe
        </a>

        {/* Right side controls */}
        <div className="flex items-center gap-3">
          {/* Theme toggle */}
          <button
            onClick={toggle}
            className="rounded-lg p-2 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300"
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

          {isAuthenticated ? (
            <>
              {/* Credit balance */}
              {balance !== null && (
                <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {balance} min
                </div>
              )}

              {/* Buy Credits button */}
              <button
                onClick={onBuyCredits}
                className="btn-secondary !py-1.5 !px-3 text-xs"
              >
                Buy Credits
              </button>

              {/* User dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
                  title={user?.email || 'Account'}
                >
                  {user?.picture ? (
                    <img
                      src={user.picture}
                      alt={user.name || 'User'}
                      className="h-8 w-8 rounded-full border border-stone-200 dark:border-stone-700"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                      {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <svg className="h-4 w-4 text-stone-400 dark:text-stone-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-lg border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
                    <div className="border-b border-stone-100 px-4 py-3 dark:border-stone-800">
                      <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                        {user?.name || 'User'}
                      </p>
                      <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                        {user?.email}
                      </p>
                    </div>
                    {/* Show credits in dropdown on small screens */}
                    {balance !== null && (
                      <div className="border-b border-stone-100 px-4 py-2 sm:hidden dark:border-stone-800">
                        <p className="text-sm text-stone-600 dark:text-stone-400">
                          Credits: <span className="font-semibold text-brand-700 dark:text-brand-300">{balance} min</span>
                        </p>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        onLogout();
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-stone-700 transition-colors hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800"
                    >
                      <svg className="h-4 w-4 text-stone-400 dark:text-stone-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <button
              onClick={onSignIn}
              className="btn-primary !py-1.5 !px-4 text-sm"
            >
              Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
