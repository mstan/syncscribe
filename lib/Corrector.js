// lib/Corrector.js
const debug = require('debug')('SubtitleGenerator:Corrector');
const https = require('https');

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

function isRetryable(error) {
  const status = error.status || error.statusCode;
  return status === 429 || (status >= 500 && status < 600);
}

async function withRetry(fn, label) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < MAX_RETRIES && isRetryable(error)) {
        const delay = RETRY_DELAYS[attempt];
        debug(`${label} failed (${error.status}), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
}

class Corrector {
  constructor(handler) {
    this.handler = handler;
    this.client = null;
  }

  async init() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY not found in environment variables. ' +
        'Please add it to your .env file or set it as an environment variable.'
      );
    }

    const OpenAI = require('openai');
    this.client = new OpenAI({ apiKey });

    debug('Corrector initialized with OpenAI API');
  }

  /**
   * Correct transcription segments using series context.
   * Looks up reference data from Wikipedia, then runs a focused LLM correction pass.
   * @param {Array} segments - Transcription segments with { text, start, end, ... }
   * @param {string} seriesContext - User-provided series/episode context string
   * @returns {Promise<Array>} Corrected segments array
   */
  async correctSegments(segments, seriesContext) {
    debug('Correcting %d segments with series context: %s', segments.length, seriesContext);

    try {
      const referenceData = await this._fetchReferenceData(seriesContext);

      if (!referenceData.characterNames.length && !referenceData.synopsis) {
        debug('No reference data found, skipping correction');
        return segments;
      }

      debug('Reference data: %d character names, synopsis length=%d',
        referenceData.characterNames.length,
        referenceData.synopsis.length
      );

      const corrected = await this._applyCorrections(segments, referenceData, seriesContext);
      return corrected;
    } catch (error) {
      debug('Correction failed, returning original segments: %s', error.message);
      console.log('  Warning: Series context correction failed, using uncorrected transcription');
      return segments;
    }
  }

  /**
   * Fetch reference data (character names, synopsis) from Wikipedia.
   * @param {string} seriesContext - User's freeform series/episode text
   * @returns {Promise<{characterNames: string[], synopsis: string}>}
   */
  async _fetchReferenceData(seriesContext) {
    // Step 1: Use GPT-4o-mini to extract the show name and search queries
    const extraction = await this._extractSearchTerms(seriesContext);
    debug('Extracted search terms: %O', extraction);

    let characterNames = [];
    let synopsis = '';

    // Include any terms GPT already knows about this series
    if (Array.isArray(extraction.knownTerms)) {
      characterNames.push(...extraction.knownTerms);
    }

    // Step 2: Search Wikipedia for the main article (synopsis)
    if (extraction.mainQuery) {
      const mainArticle = await this._wikiSearch(extraction.mainQuery);
      if (mainArticle) {
        const extract = await this._wikiExtract(mainArticle);
        if (extract) {
          synopsis = extract;
        }
      }
    }

    // Step 3: Search for character list article, extract names from section headings
    if (extraction.characterQuery) {
      const charArticle = await this._wikiSearch(extraction.characterQuery);
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
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });

    return { characterNames, synopsis };
  }

  /**
   * Use GPT-4o-mini to extract search terms from user's freeform text.
   */
  async _extractSearchTerms(seriesContext) {
    const completion = await withRetry(() =>
      this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Extract search terms from the user's series/episode description. Return JSON with:
- "showName": the name of the show/movie/game
- "mainQuery": a Wikipedia search query for the show or specific episode (e.g. "Gundam SEED episode 23" or "Gundam SEED")
- "characterQuery": a query to find the character list (e.g. "List of Gundam SEED characters")
- "knownTerms": an array of proper nouns you already know from this series (location names, faction names, ship names, weapon names, special terms). For example, for Gundam SEED: ["ZAFT", "Archangel", "Strike", "Orb", "PLANT", "Gibraltar", "Carpentaria", "Heliopolis", "Earth Alliance", "Coordinators", "Naturals", "Gottfried", "Lohengrin"]

Return ONLY valid JSON, no other text.`
          },
          { role: 'user', content: seriesContext }
        ],
        temperature: 0,
        response_format: { type: 'json_object' }
      }),
      'Extract search terms'
    );

    try {
      return JSON.parse(completion.choices[0].message.content);
    } catch {
      return { showName: seriesContext, mainQuery: seriesContext, characterQuery: null };
    }
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

          // Also add first name as a short form (e.g. "Kira" from "Kira Yamato")
          const parts = name.split(/\s+/);
          if (parts.length > 1) {
            const firstName = parts[0];
            if (firstName.length > 2 && !seen.has(firstName.toLowerCase())) {
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
   * @param {string} seriesContext - Original user context string
   * @returns {Promise<Array>} Corrected segments
   */
  async _applyCorrections(segments, referenceData, seriesContext) {
    const { characterNames, synopsis } = referenceData;

    const allText = segments.map(seg => seg.text).join('\n');

    const namesList = characterNames.length > 0
      ? characterNames.join(', ')
      : '(none found)';

    const synopsisBlock = synopsis || '(not available)';

    const systemPrompt = `You are a subtitle spell-checker for "${seriesContext}".

Reference proper names: ${namesList}

Brief synopsis: ${synopsisBlock}

Speech-to-text often produces phonetic approximations of proper names. Your ONLY job is to identify misspelled proper names and propose exact replacements.

Return a JSON object with a single key "replacements" containing an array of objects, each with:
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

    const completion = await withRetry(() =>
      this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: allText }
        ],
        temperature: 0,
        response_format: { type: 'json_object' }
      }),
      'Apply corrections'
    );

    let replacements;
    try {
      const result = JSON.parse(completion.choices[0].message.content);
      replacements = Array.isArray(result.replacements) ? result.replacements : [];
    } catch {
      debug('Failed to parse correction response');
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
