// lib/Corrector.js
const debug = require('debug')('SubtitleGenerator:Corrector');
const https = require('https');

const TextModel = require('./TextModel');

// The identification step sees the start of the transcript plus a slice from
// the middle (cold opens and theme songs can be unrepresentative).
const IDENTIFY_HEAD_CHARS = 6000;
const IDENTIFY_MID_CHARS = 3000;

const IDENTIFY_SCHEMA = {
  name: 'media_identification',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['identified', 'confidence', 'title', 'episode', 'mainQuery', 'characterQuery', 'knownTerms'],
    properties: {
      identified: { type: 'boolean' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      title: { type: ['string', 'null'] },
      episode: { type: ['string', 'null'] },
      mainQuery: { type: ['string', 'null'] },
      characterQuery: { type: ['string', 'null'] },
      knownTerms: { type: 'array', items: { type: 'string' } }
    }
  }
};

const REPLACEMENTS_SCHEMA = {
  name: 'name_replacements',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['replacements'],
    properties: {
      replacements: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['wrong', 'correct'],
          properties: {
            wrong: { type: 'string' },
            correct: { type: 'string' }
          }
        }
      }
    }
  }
};

/**
 * True when most letters are Latin script. Reference names come from English
 * Wikipedia, so correcting e.g. a Japanese transcript would swap scripts.
 */
function isMostlyLatin(text) {
  const letters = text.match(/\p{L}/gu) || [];
  if (letters.length === 0) return false;
  const latin = letters.filter(ch => /\p{Script=Latin}/u.test(ch)).length;
  return latin / letters.length >= 0.8;
}

// Leading words of character-list headings that are not usable short names.
const NOT_A_FIRST_NAME = /^(the|an?|of|dr|mr|mrs|ms|miss|sir|lord|lady|captain|commander|lieutenant|general|admiral|colonel|major|king|queen|prince|princess|professor|doctor|father|mother|uncle|aunt)\.?$/i;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class Corrector {
  constructor(handler) {
    this.handler = handler;
    this.model = null;
  }

  async init() {
    this.model = new TextModel();
    debug('Corrector initialized (%s)', this.model.model);
  }

  /**
   * Fix misheard proper names (characters, places, factions, ships...) with no
   * input from the user: identify the title from the file name, embedded
   * container title, and the transcript itself; pull reference names from
   * Wikipedia; then apply only replacements backed by that reference data.
   * Never throws: on any failure the original segments come back unchanged.
   * @param {Array} segments - Transcription segments with { text, start, end, ... }
   * @param {object} [hints]
   * @param {string} [hints.fileName] - Original media file name
   * @param {string} [hints.mediaTitle] - Title from the container metadata
   * @returns {Promise<{segments: Array, identification: object|null, names: string[]}>}
   *   names = reference names that occur in the corrected text (a translation glossary)
   */
  async correctSegments(segments, hints = {}) {
    const unchanged = { segments, identification: null, names: [] };

    try {
      const allText = segments.map(seg => seg.text).join('\n');
      if (!isMostlyLatin(allText)) {
        debug('Transcript is not mostly Latin script; skipping name correction');
        return unchanged;
      }

      const identification = await this._identify(allText, hints);
      debug('Identification: %O', identification);
      if (!identification.identified || identification.confidence === 'low' || !identification.title) {
        debug('Title not confidently identified; skipping name correction');
        return { ...unchanged, identification };
      }

      const referenceData = await this._fetchReferenceData(identification);
      if (!referenceData.characterNames.length && !referenceData.synopsis) {
        debug('No reference data found, skipping correction');
        return { ...unchanged, identification };
      }

      debug('Reference data: %d names, synopsis length=%d',
        referenceData.characterNames.length, referenceData.synopsis.length);

      const corrected = await this._applyCorrections(segments, referenceData, identification);
      const correctedText = corrected.map(seg => seg.text).join('\n');
      const names = referenceData.characterNames.filter(name =>
        name.length > 2 && new RegExp(`\\b${escapeRegExp(name)}\\b`).test(correctedText)
      );

      return { segments: corrected, identification, names };
    } catch (error) {
      debug('Correction failed, returning original segments: %s', error.message);
      console.log('  Warning: name correction failed, using uncorrected transcription');
      return unchanged;
    }
  }

  /**
   * Work out what the media is from whatever evidence there is.
   * @returns {Promise<object>} Matches IDENTIFY_SCHEMA
   */
  async _identify(allText, { fileName, mediaTitle } = {}) {
    const head = allText.slice(0, IDENTIFY_HEAD_CHARS);
    const midStart = Math.max(IDENTIFY_HEAD_CHARS, Math.floor(allText.length / 2 - IDENTIFY_MID_CHARS / 2));
    const middle = allText.length > IDENTIFY_HEAD_CHARS ? allText.slice(midStart, midStart + IDENTIFY_MID_CHARS) : '';

    const input = [
      `File name: ${fileName || '(unknown)'}`,
      `Embedded title: ${mediaTitle || '(none)'}`,
      '',
      'Transcript excerpt (speech-to-text, so proper names may be misspelled phonetically):',
      head,
      middle ? `\n[...]\n${middle}` : ''
    ].join('\n');

    return this.model.respond({
      label: 'Identify media',
      effort: 'medium',
      schema: IDENTIFY_SCHEMA,
      instructions: `Identify which TV series, anime, film, game, or other published work this audio comes from, using the file name, the embedded title, and the transcript. File names often carry the title and episode (e.g. "[Group] Mobile Suit Gundam SEED - 05 [1080p].mkv"). Transcripts carry recurring character and place names, even when misheard.

Set "identified" to true only if you can name the specific work. "confidence" is "high" when the file name or title names it or the transcript makes it unmistakable, "medium" when the transcript strongly suggests it, and "low" otherwise. Home videos, lectures, podcasts and generic talk are not identifiable works: return identified=false.

When identified:
- "title": the work's canonical English title.
- "episode": the episode number/title if known, else null.
- "mainQuery": an English Wikipedia search query for the work's article.
- "characterQuery": a query for its character list article (e.g. "List of Mobile Suit Gundam SEED characters"), or null if none is likely to exist.
- "knownTerms": proper nouns you are confident appear in this work: characters, places, factions, ships, vehicles, weapons, special terms. Spell them exactly as the official English materials do.

When not identified, use null for the strings and [] for knownTerms.`,
      input
    });
  }

  /**
   * Fetch reference data (character names, synopsis) from Wikipedia.
   * @param {object} identification - From _identify
   * @returns {Promise<{characterNames: string[], synopsis: string}>}
   */
  async _fetchReferenceData(identification) {
    let characterNames = [...identification.knownTerms];
    let synopsis = '';

    // Main article (synopsis)
    const mainArticle = await this._wikiSearch(identification.mainQuery || identification.title);
    if (mainArticle) {
      const extract = await this._wikiExtract(mainArticle);
      if (extract) {
        synopsis = extract;
      }
    }

    // Character list article: names come from its section headings
    if (identification.characterQuery) {
      const charArticle = await this._wikiSearch(identification.characterQuery);
      if (charArticle) {
        const wikiNames = await this._wikiSectionHeadings(charArticle);
        characterNames.push(...wikiNames);

        // Also grab the character list article intro — it's rich in faction/ship/location names
        const charIntro = await this._wikiExtract(charArticle);
        if (charIntro) {
          synopsis = synopsis ? (synopsis + '\n\n' + charIntro) : charIntro;
        }
      }
    }

    // Deduplicate names (case-insensitive)
    const seen = new Set();
    characterNames = characterNames.filter(name => {
      const lower = name.toLowerCase();
      if (!lower || seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });

    return { characterNames, synopsis };
  }

  /**
   * Search Wikipedia and return the title of the top result.
   * @param {string} query - Search query
   * @returns {Promise<string|null>} Article title or null
   */
  async _wikiSearch(query) {
    const params = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: '1',
      format: 'json'
    });

    try {
      const data = await this._wikiRequest(params);
      if (data.query && data.query.search && data.query.search.length > 0) {
        const title = data.query.search[0].title;
        debug('Wiki search "%s" -> "%s"', query, title);
        return title;
      }
    } catch (error) {
      debug('Wiki search failed for "%s": %s', query, error.message);
    }

    return null;
  }

  /**
   * Fetch the text extract of a Wikipedia article (intro section, max 1200 chars).
   * @param {string} title - Article title
   * @returns {Promise<string|null>}
   */
  async _wikiExtract(title) {
    const params = new URLSearchParams({
      action: 'query',
      titles: title,
      prop: 'extracts',
      exchars: '1200',
      explaintext: '1',
      format: 'json'
    });

    try {
      const data = await this._wikiRequest(params);
      const pages = data.query && data.query.pages;
      if (pages) {
        const page = Object.values(pages)[0];
        if (page && page.extract) {
          debug('Wiki extract for "%s": %d chars', title, page.extract.length);
          return page.extract;
        }
      }
    } catch (error) {
      debug('Wiki extract failed for "%s": %s', title, error.message);
    }

    return null;
  }

  /**
   * Get character names from section headings of a Wikipedia character list article.
   * On "List of ... characters" pages, each subsection heading IS a character name.
   * This is far more reliable than trying to extract names from article text.
   * @param {string} title - Article title
   * @returns {Promise<string[]>} Array of character names
   */
  async _wikiSectionHeadings(title) {
    const params = new URLSearchParams({
      action: 'parse',
      page: title,
      prop: 'sections',
      format: 'json'
    });

    try {
      const data = await this._wikiRequest(params);
      if (data.parse && data.parse.sections) {
        // Category headings (toclevel 1) are things like "Protagonists", "ZAFT", etc.
        // Character names are toclevel 2+ subsections.
        const names = [];
        const seen = new Set();
        const skipPatterns = /^(protagonists?|antagonists?|supporting|others?|references|external links|notes|see also|crew|staff|voice cast)/i;

        for (const section of data.parse.sections) {
          if (section.toclevel < 2) continue;

          // Strip HTML tags (some headings have <i>...</i>)
          let name = section.line.replace(/<[^>]+>/g, '').trim();

          if (!name || skipPatterns.test(name) || seen.has(name.toLowerCase())) continue;
          seen.add(name.toLowerCase());

          names.push(name);

          // Also add first name as a short form (e.g. "Kira" from "Kira Yamato"),
          // unless the first word is an article or title ("The Hawk of Endymion").
          const parts = name.split(/\s+/);
          if (parts.length > 1) {
            const firstName = parts[0];
            if (firstName.length > 2 && !NOT_A_FIRST_NAME.test(firstName) && !seen.has(firstName.toLowerCase())) {
              seen.add(firstName.toLowerCase());
              names.push(firstName);
            }
          }
        }

        debug('Wiki sections for "%s": %d character names', title, names.length);
        return names;
      }
    } catch (error) {
      debug('Wiki sections failed for "%s": %s', title, error.message);
    }

    return [];
  }

  /**
   * Make an HTTPS request to the Wikipedia API.
   * @param {URLSearchParams} params
   * @returns {Promise<object>}
   */
  _wikiRequest(params) {
    const url = `https://en.wikipedia.org/w/api.php?${params.toString()}`;

    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: { 'User-Agent': 'SyncScribe/1.0 (subtitle correction tool)' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse Wikipedia response'));
          }
        });
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Apply corrections to segments using reference data.
   * Asks GPT to propose find→replace pairs, then executes them mechanically.
   * @param {Array} segments - Original segments
   * @param {object} referenceData - { characterNames, synopsis }
   * @param {object} identification - From _identify
   * @returns {Promise<Array>} Corrected segments
   */
  async _applyCorrections(segments, referenceData, identification) {
    const { characterNames, synopsis } = referenceData;

    const allText = segments.map(seg => seg.text).join('\n');

    const namesList = characterNames.length > 0
      ? characterNames.join(', ')
      : '(none found)';

    const synopsisBlock = synopsis || '(not available)';

    const work = identification.episode ? `${identification.title} (${identification.episode})` : identification.title;
    const systemPrompt = `You are a subtitle spell-checker for "${work}".

Reference proper names: ${namesList}

Brief synopsis: ${synopsisBlock}

Speech-to-text often produces phonetic approximations of proper names. Your ONLY job is to identify misspelled proper names and propose exact replacements.

Return "replacements": an array of objects, each with:
- "wrong": the exact misspelled word/phrase as it appears in the text
- "correct": the correct spelling from the reference list

Rules:
- ONLY fix proper nouns (character names, place names, faction names, ship names, mecha names)
- The "wrong" value must appear EXACTLY as-is in the subtitle text
- Each entry is a global find-and-replace — every occurrence of "wrong" will be replaced with "correct"
- Do NOT propose replacements for words that are already correct
- Do NOT propose replacements you are not confident about
- If no corrections needed, return {"replacements": []}

Examples of good replacements:
{"wrong": "Ezak", "correct": "Yzak"}
{"wrong": "Afrin", "correct": "Athrun"}
{"wrong": "Kigali", "correct": "Cagalli"}
{"wrong": "ZAP", "correct": "ZAFT"}
{"wrong": "D'Arca", "correct": "Dearka"}`;

    let replacements;
    try {
      const result = await this.model.respond({
        label: 'Apply corrections',
        effort: 'high',
        schema: REPLACEMENTS_SCHEMA,
        instructions: systemPrompt,
        input: allText
      });
      replacements = result.replacements;
    } catch (error) {
      debug('Correction request failed: %s', error.message);
      return segments;
    }

    if (replacements.length === 0) {
      debug('No corrections proposed');
      return segments;
    }

    // Build a case-insensitive set of all reference terms for validation
    const refSet = new Set(characterNames.map(n => n.toLowerCase()));

    // Validate and apply replacements mechanically
    const correctedSegments = segments.map(seg => ({ ...seg }));
    let totalReplacements = 0;

    for (const { wrong, correct } of replacements) {
      if (!wrong || !correct || wrong === correct) continue;
      if (typeof wrong !== 'string' || typeof correct !== 'string') continue;

      // The "correct" value must exist in our reference data.
      // Check if the full correction OR any word in it matches a reference term.
      const correctLower = correct.toLowerCase();
      const correctWords = correctLower.split(/\s+/);
      const hasRef = refSet.has(correctLower) ||
        correctWords.some(w => w.length > 2 && refSet.has(w));

      if (!hasRef) {
        debug('Skipping proposed replacement "%s" -> "%s" (not in reference data)', wrong, correct);
        continue;
      }

      // Reject if wrong is just a plural/singular variant of correct (e.g. Gottfrieds -> Gottfried)
      const wLower = wrong.toLowerCase();
      if (wLower === correctLower + 's' || wLower + 's' === correctLower ||
          wLower === correctLower + "'s" || wLower + "'s" === correctLower) {
        debug('Skipping proposed replacement "%s" -> "%s" (plural/possessive variant)', wrong, correct);
        continue;
      }

      // Verify the "wrong" text actually exists somewhere in the segments
      let found = false;
      for (const seg of correctedSegments) {
        if (seg.text.includes(wrong)) {
          found = true;
          break;
        }
      }

      if (!found) {
        debug('Skipping proposed replacement "%s" -> "%s" (not found in text)', wrong, correct);
        continue;
      }

      // Apply as case-sensitive find-and-replace across all segments
      let count = 0;
      for (const seg of correctedSegments) {
        if (seg.text.includes(wrong)) {
          const before = seg.text;
          seg.text = seg.text.split(wrong).join(correct);
          count++;
          debug('Replace "%s" -> "%s" in: "%s"', wrong, correct, before);
        }
      }
      totalReplacements += count;
      console.log(`  Correction: "${wrong}" -> "${correct}" (${count} occurrence${count !== 1 ? 's' : ''})`);
    }

    debug('Applied %d replacements across %d segments', totalReplacements, segments.length);
    console.log(`  Total: ${totalReplacements} replacements from ${replacements.length} rules`);

    return correctedSegments;
  }
}

module.exports = Corrector;
