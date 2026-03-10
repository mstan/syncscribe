/**
 * Centralized language configuration.
 * Single source of truth for all language codes, names, and mappings.
 * Uses named ESM exports; CJS shim at bottom for backend require().
 */

/**
 * All supported languages (ISO 639-1), alphabetically sorted by name.
 * Excludes RTL scripts (Arabic, Hebrew, Persian, Urdu) which render poorly in SRT.
 */
const LANGUAGES = [
  { code: 'af', name: 'Afrikaans' },
  { code: 'hy', name: 'Armenian' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'be', name: 'Belarusian' },
  { code: 'bs', name: 'Bosnian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'ca', name: 'Catalan' },
  { code: 'zh', name: 'Chinese' },
  { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'et', name: 'Estonian' },
  { code: 'tl', name: 'Filipino' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'gl', name: 'Galician' },
  { code: 'ka', name: 'Georgian' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'is', name: 'Icelandic' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'kn', name: 'Kannada' },
  { code: 'kk', name: 'Kazakh' },
  { code: 'ko', name: 'Korean' },
  { code: 'lv', name: 'Latvian' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'mk', name: 'Macedonian' },
  { code: 'ms', name: 'Malay' },
  { code: 'mr', name: 'Marathi' },
  { code: 'mn', name: 'Mongolian' },
  { code: 'no', name: 'Norwegian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'es', name: 'Spanish' },
  { code: 'sw', name: 'Swahili' },
  { code: 'sv', name: 'Swedish' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'cy', name: 'Welsh' },
  { code: 'zu', name: 'Zulu' },
];

/** Special auto-detect entry (not in LANGUAGES array). */
const AUTO_DETECT = { code: 'auto', name: 'Auto-detect' };

/** { code: name } map derived from LANGUAGES. */
const LANGUAGE_NAMES = Object.fromEntries(LANGUAGES.map(l => [l.code, l.name]));
LANGUAGE_NAMES[AUTO_DETECT.code] = AUTO_DETECT.name;

/** ISO 639-1 (2-letter) to ISO 639-2 (3-letter) mapping for ffmpeg metadata. */
const LANG_TO_ISO639_2 = {
  af: 'afr', hy: 'arm', az: 'aze', be: 'bel', bs: 'bos',
  bg: 'bul', ca: 'cat', zh: 'chi', hr: 'hrv', cs: 'cze',
  da: 'dan', nl: 'dut', en: 'eng', et: 'est', tl: 'fil',
  fi: 'fin', fr: 'fre', gl: 'glg', ka: 'geo', de: 'ger',
  el: 'gre', hi: 'hin', hu: 'hun', is: 'ice', id: 'ind',
  it: 'ita', ja: 'jpn', kn: 'kan', kk: 'kaz', ko: 'kor',
  lv: 'lav', lt: 'lit', mk: 'mac', ms: 'may', mr: 'mar',
  mn: 'mon', no: 'nor', pl: 'pol', pt: 'por', ro: 'rum',
  ru: 'rus', sr: 'srp', sk: 'slo', sl: 'slv', es: 'spa',
  sw: 'swa', sv: 'swe', ta: 'tam', te: 'tel', th: 'tha',
  tr: 'tur', uk: 'ukr', vi: 'vie', cy: 'wel', zu: 'zul',
  auto: 'und',
};

/** ISO 639-2 (3-letter) to ISO 639-1 (2-letter) reverse map.
 *  Includes both bibliographic (B) and terminological (T) codes where they differ. */
const ISO639_2_TO_1 = {};
for (const [iso1, iso2] of Object.entries(LANG_TO_ISO639_2)) {
  if (iso1 !== 'auto') ISO639_2_TO_1[iso2] = iso1;
}
// Add alternate ISO 639-2 codes (terminological variants)
const ALT_CODES = {
  hye: 'hy', aze: 'az', bel: 'be', bos: 'bs', bul: 'bg',
  cat: 'ca', zho: 'zh', ces: 'cs', nld: 'nl', fra: 'fr',
  kat: 'ka', deu: 'de', ell: 'el', isl: 'is', jpn: 'ja',
  mkd: 'mk', msa: 'ms', ron: 'ro', slk: 'sk', spa: 'es',
  swe: 'sv', tur: 'tr', ukr: 'uk', vie: 'vi', cym: 'cy',
};
Object.assign(ISO639_2_TO_1, ALT_CODES);

/** ISO 639-2 (3-letter) to display name mapping. */
const ISO639_2_NAMES = {};
for (const [iso2, iso1] of Object.entries(ISO639_2_TO_1)) {
  ISO639_2_NAMES[iso2] = LANGUAGE_NAMES[iso1] || iso1.toUpperCase();
}

/** Look up display name for an ISO 639-1 code. */
function getLangName(code) {
  return LANGUAGE_NAMES[code] || code.toUpperCase();
}

/** Look up ISO 639-2 (3-letter) code for an ISO 639-1 code. */
function getIso3(code) {
  return LANG_TO_ISO639_2[code] || 'und';
}

module.exports = {
  LANGUAGES,
  AUTO_DETECT,
  LANGUAGE_NAMES,
  LANG_TO_ISO639_2,
  ISO639_2_TO_1,
  ISO639_2_NAMES,
  getLangName,
  getIso3,
};
