/**
 * Marketing facts shared by the landing page (rendered UI) and the build-time
 * head tags (JSON-LD in index.html, see vite.config.js). Keep this the single
 * source so the visible copy and the structured data can't drift apart.
 *
 * Plain JS (no JSX) so vite.config.js can import it directly.
 */

export const SITE_URL = 'https://syncscribe.cc/';

export const SITE_DESCRIPTION =
  'AI subtitle generator for any video. Download SRT and VTT subtitles in 55 languages. ' +
  'Your video stays on your device: audio is extracted in your browser and only the audio is uploaded. ' +
  'Pay-as-you-go credits, 10 free minutes on signup.';

/**
 * Credit packs as advertised. Must match the packs served by /api/credit-packs.
 * minutes = transcription credits (1 credit = 1 minute of audio).
 */
export const CREDIT_PACKS = [
  { name: 'Single', price: '4.99', minutes: 120 },
  { name: 'Season', price: '12.99', minutes: 400, popular: true },
  { name: 'Studio', price: '39.99', minutes: 1500 },
];

/**
 * FAQ entries. Answers are plain text so they can be emitted verbatim into the
 * FAQPage JSON-LD. Cost wording mirrors Credits.calculateJobCost:
 * ceil(seconds / 60) minutes, plus ceil(minutes * 0.5) per extra language.
 */
export const FAQ = [
  {
    q: 'Does my video get uploaded?',
    a: 'No. Audio is extracted in your browser with WebAssembly, and only the audio track is uploaded. Your video file never leaves your device.',
  },
  {
    q: 'What formats do I get?',
    a: 'SRT and VTT files for every language you choose, or an MKV with the subtitle tracks embedded. Embedding is done in your browser and produces soft (toggleable) subtitles.',
  },
  {
    q: 'How much does it cost?',
    a: 'Pay-as-you-go credit packs, where 1 credit = 1 minute of audio. Each extra translation language costs half a credit per minute of audio. Credits never expire, and you get 10 free minutes on signup.',
  },
  {
    q: 'Which languages are supported?',
    a: '55 languages, with automatic language detection. Any of them can also be chosen as a translation target.',
  },
  {
    q: 'Can it get character names right?',
    a: 'Yes, automatically. SyncScribe works out which show or film it is from the file name and the dialogue, looks up its character and place names, and fixes misheard ones. It only applies corrections backed by that reference data, and leaves home videos and other unrecognized audio alone.',
  },
  {
    q: 'How long can a file be?',
    a: 'Feature-length files are supported.',
  },
];
