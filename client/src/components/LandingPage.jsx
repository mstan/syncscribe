import { CREDIT_PACKS, FAQ } from '../content/marketing';

/**
 * LandingPage -- marketing page shown to unauthenticated visitors.
 * Renders inside AppShell (inherits TopBar + footer).
 * Also prerendered into dist/index.html at build time (see src/prerender.jsx),
 * so it must render without browser globals, and interactive bits (the FAQ)
 * use native elements that work before React takes over.
 */

const STEPS = [
  {
    title: 'Drop in a video',
    desc: 'MKV, MP4, MOV, AVI, WebM, or an audio file. Multi-track files let you pick the audio track.',
  },
  {
    title: 'Pick your languages',
    desc: '55 languages with auto-detect. Add translations to as many languages as you need.',
  },
  {
    title: 'Download subtitles',
    desc: 'SRT and VTT for every language, or the original video back as an MKV with the tracks embedded.',
  },
];

const CORRECTIONS = [
  ['Ezak', 'Yzak'],
  ['Afrin', 'Athrun'],
  ['Kigali', 'Cagalli'],
  ['ZAP', 'ZAFT'],
];

const SAMPLE_LANGUAGES = ['English', 'Japanese', 'Spanish', 'French', 'German', 'Korean', 'Portuguese', 'Chinese', 'Italian', 'Russian'];

function hourly(pack) {
  return (Number(pack.price) / (pack.minutes / 60)).toFixed(2);
}

function Check() {
  return (
    <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-600 dark:text-brand-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
    </svg>
  );
}

/**
 * Hero visual: a video frame with a burned-in-style caption, the matching SRT
 * cue, and the name correction that produced it. Pure markup, no images.
 */
function ProductMock() {
  return (
    <div className="relative mx-auto w-full max-w-xl sm:mb-14 lg:max-w-none" aria-hidden="true">
      {/* Video frame */}
      <div className="overflow-hidden rounded-2xl bg-stone-900 shadow-float ring-1 ring-stone-900/10 dark:ring-white/10">
        <div className="flex items-center gap-1.5 border-b border-white/5 bg-stone-900 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="ml-3 truncate font-mono text-[11px] text-white/40">gundam_seed_05.mkv</span>
        </div>
        <div className="relative aspect-video bg-[radial-gradient(120%_90%_at_70%_20%,#57534e_0%,#292524_45%,#0c0a09_100%)]">
          {/* Horizon glow, so the frame reads as a scene */}
          <div className="absolute inset-x-0 bottom-1/3 h-24 bg-[radial-gradient(60%_100%_at_50%_100%,rgba(251,191,36,0.22),transparent)]" />
          <span className="absolute left-4 top-4 rounded-md bg-black/40 px-2 py-1 text-[11px] font-medium text-white/80 backdrop-blur">
            EN &middot; auto-detected
          </span>
          <p className="absolute inset-x-6 bottom-9 text-center text-base font-semibold leading-snug text-white [text-shadow:0_2px_6px_rgba(0,0,0,0.9)] sm:text-lg">
            Yzak, pull back! The Duel can&rsquo;t take another hit.
          </p>
          {/* Scrubber */}
          <div className="absolute inset-x-4 bottom-3 h-1 rounded-full bg-white/15">
            <div className="h-1 w-[38%] rounded-full bg-brand-400" />
          </div>
        </div>
      </div>

      {/* SRT cue card */}
      <div className="card absolute left-[-1rem] top-full -mt-5 hidden w-64 p-4 shadow-lift sm:block lg:left-[-2.5rem]">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">episode05.en.srt</span>
          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500 dark:bg-stone-800 dark:text-stone-400">SRT</span>
        </div>
        <pre className="font-mono text-[12px] leading-relaxed text-stone-700 dark:text-stone-300">{`142
00:04:31,220 --> 00:04:33,870
Yzak, pull back!`}</pre>
      </div>

      {/* Correction chip */}
      <div className="card absolute -right-3 -top-5 hidden items-center gap-2 px-3.5 py-2.5 shadow-lift sm:flex lg:-right-6">
        <span className="font-mono text-xs text-stone-400 line-through decoration-stone-300">Ezak</span>
        <svg className="h-3.5 w-3.5 text-stone-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
        </svg>
        <span className="font-mono text-xs font-semibold text-stone-900 dark:text-stone-100">Yzak</span>
        <span className="ml-1 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-800 dark:bg-brand-950 dark:text-brand-300">name fixed</span>
      </div>
    </div>
  );
}

export default function LandingPage({ onSignIn }) {
  return (
    <div className="w-full">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-950">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(28,25,23,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(28,25,23,0.04)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-4 pb-24 pt-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:pb-28 lg:pt-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-600 shadow-card dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
              Now with automatic character-name correction
            </p>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl lg:text-[3.5rem] lg:leading-[1.05] dark:text-stone-50">
              Accurate subtitles for any&nbsp;video.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-600 dark:text-stone-400">
              Drop in a file and get SRT and VTT subtitles in 55 languages, with character names spelled right.
              Audio is extracted in your browser, so your video never leaves your device.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button onClick={onSignIn} className="btn-primary px-6 py-3 text-base">
                Start free
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
                </svg>
              </button>
              <a href="#pricing" className="btn-secondary px-6 py-3 text-base">
                See pricing
              </a>
            </div>
            <p className="mt-5 text-sm text-stone-500 dark:text-stone-400">
              10 free minutes &middot; No subscription &middot; Credits never expire
            </p>
          </div>
          <ProductMock />
        </div>
      </section>

      {/* Proof strip */}
      <section className="border-b border-stone-200/80 bg-stone-50 dark:border-stone-800 dark:bg-stone-950">
        <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-y-6 px-4 py-8 text-center sm:px-6 md:grid-cols-4">
          {[
            ['55', 'languages'],
            ['0 bytes', 'of video uploaded'],
            ['SRT · VTT · MKV', 'output formats'],
            ['2–5 min', 'for a typical episode'],
          ].map(([value, label]) => (
            <div key={label}>
              <dt className="sr-only">{label}</dt>
              <dd className="text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-100">{value}</dd>
              <dd className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">{label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">How it works</p>
          <h2 className="section-title mt-3">From file to subtitles in three steps</h2>
        </div>
        <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map(({ title, desc }, i) => (
            <li key={title} className="relative">
              <div className="flex items-center gap-4">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-stone-300 font-mono text-sm font-semibold text-stone-700 dark:border-stone-700 dark:text-stone-300">
                  {i + 1}
                </span>
                {i < STEPS.length - 1 && (
                  <span className="hidden h-px flex-1 bg-stone-200 md:block dark:bg-stone-800" aria-hidden="true" />
                )}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-stone-900 dark:text-stone-100">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">{desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Features */}
      <section id="features" className="border-y border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900/40">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="max-w-2xl">
            <p className="eyebrow">Why SyncScribe</p>
            <h2 className="section-title mt-3">Built for real shows, films, and lectures</h2>
            <p className="section-lede">
              Generic speech-to-text gets the words. SyncScribe gets the names, keeps your files private, and hands you subtitles your player understands.
            </p>
          </div>

          <div className="mt-14 grid gap-5 md:grid-cols-6">
            {/* Name correction */}
            <div className="card p-7 md:col-span-4">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Names spelled right, automatically</h3>
              <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
                SyncScribe recognizes the show or film from the file name and dialogue, checks its character and place names, and fixes the ones speech-to-text mishears. Nothing to type, and only corrections backed by reference data are applied.
              </p>
              <ul className="mt-6 grid gap-2 sm:grid-cols-2">
                {CORRECTIONS.map(([wrong, right]) => (
                  <li key={wrong} className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3.5 py-2.5 font-mono text-sm dark:border-stone-800 dark:bg-stone-950">
                    <span className="text-stone-400 line-through decoration-stone-300 dark:decoration-stone-600">{wrong}</span>
                    <span className="text-stone-300 dark:text-stone-600" aria-hidden="true">&rarr;</span>
                    <span className="font-semibold text-stone-900 dark:text-stone-100">{right}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Privacy */}
            <div className="card p-7 md:col-span-2">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Private by design</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
                Audio is extracted in your browser with WebAssembly. Only the audio track is uploaded.
              </p>
              <div className="mt-6 space-y-2 text-sm">
                <div className="flex items-center justify-between rounded-lg border border-stone-200 px-3.5 py-2.5 dark:border-stone-800">
                  <span className="text-stone-700 dark:text-stone-300">Video file</span>
                  <span className="text-xs font-medium text-stone-500">stays on device</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3.5 py-2.5 dark:border-brand-900 dark:bg-brand-950/60">
                  <span className="text-stone-800 dark:text-stone-200">Audio track</span>
                  <span className="text-xs font-medium text-brand-800 dark:text-brand-300">uploaded</span>
                </div>
              </div>
            </div>

            {/* Languages */}
            <div className="card p-7 md:col-span-2">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">55 languages</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
                Auto-detects the spoken language. Translate into any of the others in the same job.
              </p>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {SAMPLE_LANGUAGES.map((lang) => (
                  <span key={lang} className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">{lang}</span>
                ))}
                <span className="rounded-md px-2 py-1 text-xs text-stone-400">+45 more</span>
              </div>
            </div>

            {/* Formats */}
            <div className="card p-7 md:col-span-2">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">SRT, VTT, or embedded</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
                Standard files for Plex, Jellyfin, VLC and YouTube, or an MKV with one soft subtitle track per language, muxed in your browser.
              </p>
            </div>

            {/* Long files */}
            <div className="card p-7 md:col-span-2">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Feature-length files</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
                Movies and long recordings are split, transcribed, and stitched back together with exact timing.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Pricing</p>
          <h2 className="section-title mt-3">Pay for what you subtitle</h2>
          <p className="section-lede">
            No subscription. Buy minutes when you need them; they never expire. Start with 10 free minutes.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-5xl gap-5 md:grid-cols-3">
          {CREDIT_PACKS.map((pack) => (
            <div
              key={pack.name}
              className={
                'relative flex flex-col rounded-2xl p-7 ' +
                (pack.popular
                  ? 'bg-stone-900 text-white shadow-float dark:bg-white dark:text-stone-900'
                  : 'card')
              }
            >
              <div className="flex items-center justify-between">
                <h3 className={'text-base font-semibold ' + (pack.popular ? '' : 'text-stone-900 dark:text-stone-100')}>{pack.name}</h3>
                {pack.popular && (
                  <span className="rounded-full bg-brand-400 px-2.5 py-0.5 text-xs font-semibold text-stone-950">Most popular</span>
                )}
              </div>
              <p className="mt-6 flex items-baseline gap-1">
                <span className={'text-4xl font-semibold tracking-tight ' + (pack.popular ? '' : 'text-stone-900 dark:text-stone-50')}>${pack.price}</span>
              </p>
              <p className={'mt-1 text-sm ' + (pack.popular ? 'text-white/70 dark:text-stone-500' : 'text-stone-500 dark:text-stone-400')}>
                {pack.minutes.toLocaleString('en-US')} minutes &middot; ${hourly(pack)}/hour
              </p>
              <ul className={'mt-7 space-y-3 text-sm ' + (pack.popular ? 'text-white/85 dark:text-stone-700' : 'text-stone-600 dark:text-stone-400')}>
                <li className="flex gap-2.5"><Check />About {Math.round(pack.minutes / 23)} TV episodes</li>
                <li className="flex gap-2.5"><Check />Automatic name correction</li>
                <li className="flex gap-2.5"><Check />SRT, VTT and MKV output</li>
                <li className="flex gap-2.5"><Check />Credits never expire</li>
              </ul>
              <button
                onClick={onSignIn}
                className={'mt-8 w-full ' + (pack.popular ? 'btn-accent py-3' : 'btn-secondary py-3')}
              >
                Get started
              </button>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-stone-500 dark:text-stone-400">
          1 credit = 1 minute of audio. Each extra translation language costs half a credit per minute.
        </p>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900/40">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_2fr]">
          <div>
            <p className="eyebrow">FAQ</p>
            <h2 className="section-title mt-3">Questions, answered</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
              Something else? <a href="mailto:syncscribe@1379.tech" className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-900 dark:text-stone-100 dark:decoration-stone-600">Email us</a>.
            </p>
          </div>
          <div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-base font-medium text-stone-900 marker:hidden dark:text-stone-100 [&::-webkit-details-marker]:hidden">
                  {q}
                  <svg className="h-5 w-5 flex-shrink-0 text-stone-400 transition-transform group-open:rotate-45" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                  </svg>
                </summary>
                <p className="mt-3 pr-10 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-stone-900 px-6 py-16 text-center shadow-float sm:px-16 dark:bg-stone-900 dark:ring-1 dark:ring-stone-800">
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Subtitle your next episode in minutes.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-white/70 sm:text-lg">
            Try it on a real file. Your first 10 minutes are on us.
          </p>
          <button onClick={onSignIn} className="btn-accent mt-9 px-7 py-3 text-base">
            Start free
          </button>
        </div>
      </section>
    </div>
  );
}
