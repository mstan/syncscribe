import { renderToStaticMarkup } from 'react-dom/server';
import AppShell from './components/AppShell';
import LandingPage from './components/LandingPage';

const noop = () => {};

/**
 * Build-time render of what an unauthenticated visitor sees on "/".
 * Loaded by the prerender plugin in vite.config.js (Node, no DOM) and injected
 * into <div id="root"> of dist/index.html so crawlers and link unfurlers get
 * real content. Not hydrated: main.jsx's createRoot replaces this markup.
 *
 * Mirrors MainPage's unauthenticated VIEW.UPLOAD branch in App.jsx so the
 * swap to the live app causes no layout shift.
 */
export function render() {
  return renderToStaticMarkup(
    <AppShell
      auth={{ user: null, isAuthenticated: false, logout: noop }}
      credits={{ balance: null }}
      onBuyCredits={noop}
      onSignIn={noop}
    >
      <LandingPage onSignIn={noop} />
      <div className="mx-auto w-full max-w-3xl px-4 py-8" />
    </AppShell>
  );
}
