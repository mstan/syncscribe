import { useState, useRef, useEffect } from 'react';

/**
 * TopBar -- top navigation bar.
 * Shows logo on the left, and auth/credits controls on the right.
 */
export default function TopBar({ user, isAuthenticated, balance, onBuyCredits, onLogout, onSignIn }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

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
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        {/* Logo / brand */}
        <a href="/" className="flex items-center gap-2 text-lg font-bold text-gray-900 transition-colors hover:text-brand-600">
          <svg className="h-6 w-6 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          SyncScribe
        </a>

        {/* Right side controls */}
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <>
              {/* Credit balance */}
              {balance !== null && (
                <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">
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
                  className="flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-gray-100"
                  title={user?.email || 'Account'}
                >
                  {user?.picture ? (
                    <img
                      src={user.picture}
                      alt={user.name || 'User'}
                      className="h-8 w-8 rounded-full border border-gray-200"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                      {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                    <div className="border-b border-gray-100 px-4 py-3">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {user?.name || 'User'}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {user?.email}
                      </p>
                    </div>
                    {/* Show credits in dropdown on small screens */}
                    {balance !== null && (
                      <div className="border-b border-gray-100 px-4 py-2 sm:hidden">
                        <p className="text-sm text-gray-600">
                          Credits: <span className="font-semibold text-brand-700">{balance} min</span>
                        </p>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        onLogout();
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
