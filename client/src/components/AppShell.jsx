import TopBar from './TopBar';

/**
 * AppShell -- main layout wrapper.
 * Provides TopBar, centered main content area, and footer.
 */
export default function AppShell({ auth, credits, onBuyCredits, onSignIn, children }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        user={auth.user}
        isAuthenticated={auth.isAuthenticated}
        balance={credits.balance}
        onBuyCredits={onBuyCredits}
        onLogout={auth.logout}
        onSignIn={onSignIn}
      />

      <main className="flex flex-1 flex-col items-center">
        {children}
      </main>

      <footer className="border-t border-gray-200 bg-white/60 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 py-5 text-sm text-gray-500">
          <a href="/#how-it-works" className="transition-colors hover:text-gray-700">
            How It Works
          </a>
          <span className="hidden sm:inline text-gray-300">|</span>
          <a href="/#pricing" className="transition-colors hover:text-gray-700">
            Pricing
          </a>
          <span className="hidden sm:inline text-gray-300">|</span>
          <a href="/privacy" className="transition-colors hover:text-gray-700">
            Privacy
          </a>
          <span className="hidden sm:inline text-gray-300">|</span>
          <a href="mailto:support@syncscribe.app" className="transition-colors hover:text-gray-700">
            Support
          </a>
        </div>
        <div className="border-t border-gray-100 py-3 text-center text-xs text-gray-400">
          SyncScribe &mdash; AI-powered subtitle generation
        </div>
      </footer>
    </div>
  );
}
