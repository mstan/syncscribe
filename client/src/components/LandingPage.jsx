/**
 * LandingPage -- marketing page shown to unauthenticated visitors.
 * Renders inside AppShell (inherits TopBar + footer).
 */
export default function LandingPage({ onSignIn }) {
  return (
    <div className="w-full">
      {/* Hero */}
      <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:py-24">
        <h1 className="text-4xl font-extrabold tracking-tight text-stone-900 sm:text-5xl dark:text-stone-50">
          Subtitles for any video, in minutes
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-stone-600 dark:text-stone-400">
          Drop in a video file, pick your languages, download SRT and VTT files.
          <br className="hidden sm:block" />
          Audio is extracted in your browser&nbsp;&mdash; your video never leaves your device.
        </p>

        <div className="mt-8 flex flex-col items-center gap-4">
          <button onClick={onSignIn} className="btn-primary px-8 py-3 text-lg">
            Get Started Free
          </button>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            10 free minutes on signup&nbsp;&mdash; no credit card required
          </p>
        </div>

        <div className="mt-8 flex items-center justify-center gap-3">
          {['SRT', 'VTT', 'MKV embed'].map((fmt) => (
            <span
              key={fmt}
              className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
            >
              {fmt}
            </span>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-stone-200 bg-white/40 dark:border-stone-800 dark:bg-stone-900/40">
        <div className="mx-auto max-w-4xl px-4 py-16">
          <h2 className="mb-12 text-center text-2xl font-bold text-stone-900 dark:text-stone-50">
            How it works
          </h2>
          <div className="grid gap-8 sm:grid-cols-3">
            {[
              {
                step: '1',
                title: 'Upload a video',
                desc: 'Drop any video or audio file into the browser. Supports MKV, MP4, AVI, MOV, WebM, and more.',
                icon: (
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                ),
              },
              {
                step: '2',
                title: 'Choose languages',
                desc: 'Pick from 55 languages for transcription. Add translations at half the credit cost per language.',
                icon: (
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                ),
              },
              {
                step: '3',
                title: 'Get your subtitles',
                desc: 'Download SRT and VTT files, or embed subtitles directly back into your video as an MKV.',
                icon: (
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                ),
              },
            ].map(({ step, title, desc, icon }) => (
              <div key={step} className="flex flex-col items-center text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600 dark:bg-brand-950 dark:text-brand-400">
                  {icon}
                </div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">
                  Step {step}
                </div>
                <h3 className="mb-2 text-lg font-semibold text-stone-900 dark:text-stone-50">{title}</h3>
                <p className="text-sm text-stone-600 dark:text-stone-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature Highlights */}
      <section className="mx-auto max-w-4xl px-4 py-16">
        <h2 className="mb-12 text-center text-2xl font-bold text-stone-900 dark:text-stone-50">
          Why SyncScribe
        </h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {[
            {
              title: 'Private by default',
              desc: 'Video never leaves your device. Only extracted audio is uploaded.',
              icon: (
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              ),
            },
            {
              title: '55 languages',
              desc: 'Transcribe in any of 55 supported languages. Add translations at half cost.',
              icon: (
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 8l6 6" />
                  <path d="M4 14l6-6 2-3" />
                  <path d="M2 5h12" />
                  <path d="M7 2h1" />
                  <path d="M22 22l-5-10-5 10" />
                  <path d="M14 18h6" />
                </svg>
              ),
            },
            {
              title: 'Ready in minutes',
              desc: 'Most files process in 2\u20135 minutes. No queues, no waiting.',
              icon: (
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              ),
            },
            {
              title: 'SRT, VTT, or embedded',
              desc: 'Download subtitle files or embed tracks directly into MKV containers.',
              icon: (
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              ),
            },
          ].map(({ title, desc, icon }) => (
            <div
              key={title}
              className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-700 dark:bg-stone-800"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-950 dark:text-brand-400">
                {icon}
              </div>
              <h3 className="mb-1 font-semibold text-stone-900 dark:text-stone-50">{title}</h3>
              <p className="text-sm text-stone-600 dark:text-stone-400">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="border-t border-stone-200 bg-white/40 dark:border-stone-800 dark:bg-stone-900/40">
        <div className="mx-auto max-w-4xl px-4 py-16">
          <h2 className="mb-4 text-center text-2xl font-bold text-stone-900 dark:text-stone-50">
            Simple, pay-as-you-go pricing
          </h2>
          <p className="mb-12 text-center text-stone-600 dark:text-stone-400">
            Credits never expire. Start with 10 free minutes.
          </p>

          <div className="grid gap-6 sm:grid-cols-3">
            {[
              { name: 'Single', price: '$4.99', minutes: '120 min' },
              { name: 'Season', price: '$12.99', minutes: '400 min', popular: true },
              { name: 'Studio', price: '$39.99', minutes: '1,500 min' },
            ].map(({ name, price, minutes, popular }) => (
              <div
                key={name}
                className={
                  'relative rounded-2xl border p-6 text-center shadow-sm ' +
                  (popular
                    ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/50'
                    : 'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800')
                }
              >
                {popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white shadow-sm">
                    Most popular
                  </span>
                )}
                <h3 className="mb-1 text-lg font-semibold text-stone-900 dark:text-stone-50">{name}</h3>
                <div className="mb-1 text-3xl font-extrabold text-stone-900 dark:text-stone-50">{price}</div>
                <div className="text-sm text-stone-500 dark:text-stone-400">{minutes}</div>
              </div>
            ))}
          </div>

          <div className="mt-10 text-center">
            <button onClick={onSignIn} className="btn-primary px-8 py-3 text-lg">
              Start Generating Subtitles
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
