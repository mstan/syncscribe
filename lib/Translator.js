// lib/Translator.js
const debug = require('debug')('SubtitleGenerator:Translator');
const TextModel = require('./TextModel');
const { getLangName } = require('../shared/languages');

// Translate in bounded batches rather than one giant request. A single call for
// hundreds of lines invites the model to merge/split/drop lines (the count
// drifts and segments silently fall back to the source language) and risks
// output truncation. Smaller batches contain any drift to a few lines, which we
// then re-translate in targeted retry passes.
const BATCH_SIZE = 40;

class Translator {
  constructor(handler) {
    this.handler = handler;
    this.model = null;
  }

  async init() {
    this.model = new TextModel();
    debug('Translator initialized (%s)', this.model.model);
  }

  /**
   * Translate subtitle segments to a target language
   * @param {Array} segments - Original transcription segments with timing
   * @param {string} targetLanguage - Target language code (e.g., 'en', 'es', 'ja')
   * @param {string} sourceLanguage - Source language code (optional, helps with accuracy)
   * @param {object} [media] - What the audio is, from the Corrector
   * @param {string} [media.title] - Identified work, e.g. "Mobile Suit Gundam SEED"
   * @param {string[]} [media.names] - Proper names that occur in the transcript
   * @returns {Promise<Array>} Translated segments with same timing
   */
  async translateSegments(segments, targetLanguage, sourceLanguage = null, media = {}) {
    debug(`Translating ${segments.length} segments to ${targetLanguage}`);

    // Get full language names for better translation accuracy. 'auto' (and any
    // unknown code) has no meaningful name.
    const targetLangName = getLangName(targetLanguage);
    const sourceLangName = sourceLanguage && sourceLanguage !== 'auto'
      ? getLangName(sourceLanguage)
      : 'the source language';
    const ctx = { targetLangName, sourceLangName, media: this._mediaBlock(media) };

    console.log(`Translating from ${sourceLangName} to ${targetLangName}...`);

    // Build the work list. Segments whose text is blank after sanitizing need no
    // translation — carry them through verbatim so they neither cost an API call
    // nor count as a "failure".
    const items = segments.map((seg, idx) => ({
      idx,
      text: this._sanitize(seg.text)
    }));
    const translatable = items.filter((it) => it.text.length > 0);

    // results: absolute index -> translated text
    const results = new Map();

    // Pass 1: translate every batch.
    await this._translatePass(translatable, results, ctx, BATCH_SIZE);

    // Pass 2: re-batch whatever is still missing (model dropped/merged lines).
    let missing = translatable.filter((it) => !results.has(it.idx));
    if (missing.length > 0) {
      debug(`Re-translating ${missing.length} segment(s) missed in pass 1`);
      await this._translatePass(missing, results, ctx, BATCH_SIZE);
    }

    // Pass 3: translate stubborn stragglers one at a time (smallest possible unit).
    missing = translatable.filter((it) => !results.has(it.idx));
    if (missing.length > 0) {
      debug(`Re-translating ${missing.length} straggler(s) individually`);
      await this._translatePass(missing, results, ctx, 1);
    }

    // Assemble final segments, marking any that never translated.
    const untranslated = [];
    const finalSegments = segments.map((seg, idx) => {
      const blank = this._sanitize(seg.text).length === 0;
      if (results.has(idx)) {
        return {
          id: seg.id,
          start: seg.start,
          end: seg.end,
          text: results.get(idx),
          tokens: seg.tokens || [],
          confidence: seg.confidence || null
        };
      }
      // Blank source lines aren't failures; anything else is a real fallback.
      if (!blank) untranslated.push(idx);
      return {
        id: seg.id,
        start: seg.start,
        end: seg.end,
        text: seg.text,
        tokens: seg.tokens || [],
        confidence: seg.confidence || null,
        untranslated: !blank ? true : undefined
      };
    });

    if (untranslated.length > 0) {
      const sample = untranslated.slice(0, 20).join(', ');
      const more = untranslated.length > 20 ? `, …(+${untranslated.length - 20} more)` : '';
      // Loud and specific: which lines fell back, not just "some segments".
      debug(
        `Translation INCOMPLETE for ${targetLangName}: ${untranslated.length}/${segments.length} ` +
        `segment(s) kept source text after 3 passes. Indices: ${sample}${more}`
      );
      console.warn(
        `  ⚠️  ${untranslated.length}/${segments.length} segment(s) could not be translated to ` +
        `${targetLangName} and kept the original text. Indices: ${sample}${more}`
      );
    } else {
      debug(`Translation completed: ${segments.length}/${segments.length} segments translated`);
    }

    return finalSegments;
  }

  /**
   * Context block telling the translator what it is translating, so names and
   * terms stay consistent. Empty when the media wasn't identified.
   * @param {{title?: string, names?: string[]}} media
   * @returns {string}
   */
  _mediaBlock({ title, names } = {}) {
    if (!title) return '';
    const glossary = (names || []).slice(0, 200);
    return `\n\nThese subtitles are from "${title}".` + (glossary.length
      ? ` Keep these proper names exactly as written (transliterate only if the target script requires it): ${glossary.join(', ')}.`
      : '');
  }

  /**
   * Collapse a segment's text to a single trimmed line. Whisper occasionally
   * emits internal newlines; left in place they break the `[n] text` line
   * protocol (the trailing line has no prefix and gets dropped), which is a
   * primary cause of count drift.
   * @param {string} text
   * @returns {string}
   */
  _sanitize(text) {
    return (text == null ? '' : String(text)).replace(/\s*\n+\s*/g, ' ').trim();
  }

  /**
   * Translate a list of items in batches, writing successes into `results`.
   * Items already present in `results` are skipped. Missing items are left for
   * the caller's next pass — this method never substitutes source text.
   * @param {Array<{idx:number,text:string}>} items
   * @param {Map<number,string>} results - absolute index -> translated text (mutated)
   * @param {{targetLangName: string, sourceLangName: string, media: string}} ctx
   * @param {number} batchSize
   */
  async _translatePass(items, results, ctx, batchSize) {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize).filter((it) => !results.has(it.idx));
      if (batch.length === 0) continue;

      const parsed = await this._translateBatch(batch, ctx);
      for (const [localIndex, text] of parsed) {
        const item = batch[localIndex];
        if (item && text) results.set(item.idx, text);
      }
    }
  }

  /**
   * Translate a single batch. The batch is numbered with LOCAL indices
   * (0..n-1) so the model never sees large numbers and the prompt stays small.
   * @param {Array<{idx:number,text:string}>} batch
   * @param {{targetLangName: string, sourceLangName: string, media: string}} ctx
   * @returns {Promise<Map<number,string>>} localIndex -> translated text
   */
  async _translateBatch(batch, { targetLangName, sourceLangName, media }) {
    const segmentsText = batch.map((it, localIndex) => `[${localIndex}] ${it.text}`).join('\n');

    const systemPrompt = `You are a professional subtitle translator. Translate the following subtitles from ${sourceLangName} to ${targetLangName}.${media}

CRITICAL RULES:
1. Output EXACTLY one line per input line, with the SAME [number] prefix.
2. NEVER merge, split, reorder, add, or omit lines — the input has ${batch.length} lines and you must return ${batch.length} lines.
3. Translate ONLY the text after the [number] prefix. Keep the whole translation on ONE line (no line breaks within a subtitle).
4. Keep translations concise — subtitles have limited screen time — and match the tone of the content.
5. If a line cannot be meaningfully translated, transliterate or repeat it but STILL output its [number] line.
6. Return ONLY the [number]-prefixed lines, nothing else.

Example:
[0] Original text here
[1] Another subtitle

Returns:
[0] Translated text here
[1] Another translated subtitle`;

    const userPrompt = `Translate these subtitles:\n\n${segmentsText}`;

    let translatedText;
    try {
      translatedText = (await this.model.respond({
        label: `Translation to ${targetLangName}`,
        effort: 'low',
        instructions: systemPrompt,
        input: userPrompt
      })).trim();
    } catch (error) {
      debug('Translation batch error:', error.message);

      if (error.status === 401) {
        throw new Error('OpenAI API authentication failed. Please check your OPENAI_API_KEY.');
      }
      if (error.status === 429) {
        throw new Error('OpenAI API rate limit exceeded after retries. Please try again later.');
      }
      // Transient/parsing-level failure for this batch: return nothing so the
      // caller retries these indices in a later pass.
      return new Map();
    }

    const parsed = new Map();

    for (const line of translatedText.split('\n')) {
      const match = line.match(/^\s*\[(\d+)\]\s*(.+?)\s*$/);
      if (!match) continue;
      const localIndex = parseInt(match[1], 10);
      const text = match[2].trim();
      if (localIndex >= 0 && localIndex < batch.length && text) {
        parsed.set(localIndex, text);
      }
    }

    return parsed;
  }
}

module.exports = Translator;
