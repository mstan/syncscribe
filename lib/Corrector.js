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

    // Step 2: Search Wikipedia for the main article
    if (extraction.mainQuery) {
      const mainArticle = await this._wikiSearch(extraction.mainQuery);
      if (mainArticle) {
        const extract = await this._wikiExtract(mainArticle, 2000);
        if (extract) {
          synopsis = extract;
        }
      }
    }

    // Step 3: Search for character list article
    if (extraction.characterQuery) {
      const charArticle = await this._wikiSearch(extraction.characterQuery);
      if (charArticle) {
        const charExtract = await this._wikiExtract(charArticle, 4000);
        if (charExtract) {
          // Use GPT-4o-mini to extract character names from the wiki text
          characterNames = await this._extractCharacterNames(charExtract, extraction.showName);
        }
      }
    }

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
   * Fetch the text extract of a Wikipedia article.
   * @param {string} title - Article title
   * @param {number} maxChars - Maximum characters to fetch
   * @returns {Promise<string|null>}
   */
  async _wikiExtract(title, maxChars) {
    const params = new URLSearchParams({
      action: 'query',
      titles: title,
      prop: 'extracts',
      exchars: String(maxChars),
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
   * Use GPT-4o-mini to extract character names from Wikipedia article text.
   * @param {string} wikiText - Wikipedia article extract
   * @param {string} showName - Name of the show
   * @returns {Promise<string[]>}
   */
  async _extractCharacterNames(wikiText, showName) {
    const completion = await withRetry(() =>
      this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Extract all character names from this Wikipedia article about "${showName}". Return a JSON object with a single key "names" containing an array of character name strings. Include both full names and common short forms (e.g. both "Kira Yamato" and "Kira"). Return ONLY valid JSON.`
          },
          { role: 'user', content: wikiText }
        ],
        temperature: 0,
        response_format: { type: 'json_object' }
      }),
      'Extract character names'
    );

    try {
      const result = JSON.parse(completion.choices[0].message.content);
      return Array.isArray(result.names) ? result.names : [];
    } catch {
      return [];
    }
  }

  /**
   * Apply corrections to segments using reference data.
   * @param {Array} segments - Original segments
   * @param {object} referenceData - { characterNames, synopsis }
   * @param {string} seriesContext - Original user context string
   * @returns {Promise<Array>} Corrected segments
   */
  async _applyCorrections(segments, referenceData, seriesContext) {
    const { characterNames, synopsis } = referenceData;

    const segmentsText = segments.map((seg, idx) => `[${idx}] ${seg.text}`).join('\n');

    const namesList = characterNames.length > 0
      ? characterNames.join(', ')
      : '(none found)';

    const synopsisBlock = synopsis
      ? synopsis.substring(0, 500)
      : '(not available)';

    const systemPrompt = `You are a subtitle proofreader for "${seriesContext}".

Reference character names: ${namesList}
Brief synopsis: ${synopsisBlock}

Review these subtitles and fix ONLY:
- Misspelled character names (match against the reference list)
- Misspelled place names or show-specific terms
- Obvious homophones/mishearings where context makes the correct word clear

DO NOT:
- Rewrite or rephrase any dialogue
- Add words, remove words, or change sentence structure
- "Improve" grammar or style
- Change anything you're not confident about

Return ONLY lines you changed, in the format [number] corrected text.
If no corrections are needed, return "NO_CORRECTIONS".`;

    const completion = await withRetry(() =>
      this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: segmentsText }
        ],
        temperature: 0.1,
      }),
      'Apply corrections'
    );

    const responseText = completion.choices[0].message.content.trim();

    if (responseText === 'NO_CORRECTIONS') {
      debug('No corrections needed');
      return segments;
    }

    // Parse corrections and apply to segments
    const correctedSegments = segments.map(seg => ({ ...seg }));
    const lines = responseText.split('\n').filter(line => line.trim());
    let correctionCount = 0;

    for (const line of lines) {
      const match = line.match(/^\[(\d+)\]\s*(.+)$/);
      if (match) {
        const index = parseInt(match[1]);
        const text = match[2].trim();

        if (correctedSegments[index]) {
          debug('Correction [%d]: "%s" -> "%s"', index, correctedSegments[index].text, text);
          correctedSegments[index].text = text;
          correctionCount++;
        }
      }
    }

    debug('Applied %d corrections to %d segments', correctionCount, segments.length);
    console.log(`  Applied ${correctionCount} name/term corrections from series context`);

    return correctedSegments;
  }
}

module.exports = Corrector;
