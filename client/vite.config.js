import { defineConfig, createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { SITE_URL, SITE_DESCRIPTION, CREDIT_PACKS, FAQ } from './src/content/marketing.js';

const ROOT_PLACEHOLDER = '<div id="root"></div>';

/**
 * Serialize JSON-LD safely for an inline <script> ("</script>" can't break out).
 */
function jsonLd(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/**
 * Inject SoftwareApplication + FAQPage JSON-LD into <head>, generated from
 * src/content/marketing.js -- the same data the landing page renders, so the
 * structured data always matches the visible copy. Runs in dev and build.
 */
function structuredDataPlugin() {
  const softwareApplication = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'SyncScribe',
    url: SITE_URL,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    description: SITE_DESCRIPTION,
    offers: CREDIT_PACKS.map(({ name, price, minutes }) => ({
      '@type': 'Offer',
      name: `${name} (${minutes.toLocaleString('en-US')} minutes)`,
      price,
      priceCurrency: 'USD',
      url: SITE_URL,
    })),
  };

  const faqPage = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };

  return {
    name: 'syncscribe-structured-data',
    transformIndexHtml() {
      return [softwareApplication, faqPage].map((data) => ({
        tag: 'script',
        attrs: { type: 'application/ld+json' },
        children: jsonLd(data),
        injectTo: 'head',
      }));
    },
  };
}

/**
 * Build-time prerender of the landing page into dist/index.html.
 *
 * The app is a client-rendered SPA, so non-JS crawlers and link unfurlers would
 * otherwise see an empty #root. This SSR-loads src/prerender.jsx through a
 * throwaway Vite server (handles JSX + the CJS shared/ import), renders it with
 * react-dom/server, and places the markup inside #root wrapped in
 * <div data-prerender>. main.jsx's createRoot replaces it on mount; the inline
 * script in index.html hides it for signed-in visitors and non-"/" routes.
 *
 * Fails the build rather than silently shipping an empty page.
 */
function prerenderLandingPlugin() {
  let root;
  return {
    name: 'syncscribe-prerender-landing',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        if (!html.includes(ROOT_PLACEHOLDER)) {
          throw new Error(`[prerender] ${ROOT_PLACEHOLDER} not found in index.html`);
        }

        const server = await createServer({
          root,
          configFile: false,
          logLevel: 'error',
          appType: 'custom',
          plugins: [react()],
          server: { middlewareMode: true, hmr: false, watch: null },
          // No dep pre-bundling for a one-shot SSR load (otherwise esbuild logs
          // "The build was canceled" when the server closes mid-scan).
          optimizeDeps: { noDiscovery: true, include: [], disabled: true },
        });

        try {
          const { render } = await server.ssrLoadModule('/src/prerender.jsx');
          const markup = render();
          if (!markup) throw new Error('[prerender] render() returned empty markup');
          return html.replace(
            ROOT_PLACEHOLDER,
            `<div id="root"><div data-prerender>${markup}</div></div>`
          );
        } finally {
          await server.close();
        }
      },
    },
  };
}

/**
 * Dev server only: shared/*.js is CommonJS (the backend require()s it), and
 * Vite's dev server serves source files as ES modules without converting
 * CommonJS outside node_modules, so `import langConfig from '../../../shared/languages.js'`
 * failed under `npm run dev`. Wrap it as an ES module exposing module.exports
 * as the default export. Production builds convert it via build.commonjsOptions.
 */
function sharedCommonJsDevPlugin() {
  return {
    name: 'syncscribe-shared-cjs-dev',
    apply: 'serve',
    transform(code, id) {
      if (!/\/shared\/[^/]+\.js$/.test(id) || !code.includes('module.exports')) return null;
      return {
        code: `const module = { exports: {} };\nconst exports = module.exports;\n${code}\nexport default module.exports;\n`,
        map: null
      };
    }
  };
}

export default defineConfig({
  plugins: [react(), sharedCommonJsDevPlugin(), structuredDataPlugin(), prerenderLandingPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000'
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
  },
  build: {
    outDir: 'dist',
    commonjsOptions: {
      include: [/node_modules/, /shared\//]
    }
  }
});
