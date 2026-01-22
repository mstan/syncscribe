// lib/Translator.js
const debug = require('debug')('SubtitleGenerator:Translator');
const OpenAI = require('openai');

class Translator {
  constructor(handler) {
    this.handler = handler;
    this.client = null;
  }

  async init() {
    // Initialize OpenAI client
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY not found in environment variables. ' +
        'Please add it to your .env file or set it as an environment variable.'
      );
    }

    this.client = new OpenAI({
      apiKey: apiKey
    });

    debug('Translator initialized with OpenAI API');
  }

  /**
   * Translate subtitle segments to a target language
   * @param {Array} segments - Original transcription segments with timing
   * @param {string} targetLanguage - Target language code (e.g., 'en', 'es', 'ja')
   * @param {string} sourceLanguage - Source language code (optional, helps with accuracy)
   * @returns {Promise<Array>} Translated segments with same timing
   */
  async translateSegments(segments, targetLanguage, sourceLanguage = null) {
    debug(`Translating ${segments.length} segments to ${targetLanguage}`);

    // Get full language names for better translation accuracy
    const targetLangName = this._getLanguageName(targetLanguage);
    const sourceLangName = sourceLanguage ? this._getLanguageName(sourceLanguage) : 'the source language';

    console.log(`Translating from ${sourceLangName} to ${targetLangName}...`);

    // Translate all segments in a single API call (subtitle text is small)
    const translatedSegments = await this._translateAllSegments(
      segments,
      targetLangName,
      sourceLangName
    );

    debug(`Translation completed: ${translatedSegments.length} segments`);
    return translatedSegments;
  }

  /**
   * Translate all segments in a single API call
   * @param {Array} segments - All segments to translate
   * @param {string} targetLangName - Full target language name
   * @param {string} sourceLangName - Full source language name
   * @returns {Promise<Array>} Translated segments
   */
  async _translateAllSegments(segments, targetLangName, sourceLangName) {
    // Create a structured format for translation
    const segmentsText = segments.map((seg, idx) => {
      return `[${idx}] ${seg.text}`;
    }).join('\n');

    const systemPrompt = `You are a professional subtitle translator. Translate the following subtitles from ${sourceLangName} to ${targetLangName}.

CRITICAL RULES:
1. Preserve the [number] prefix for each line EXACTLY as shown
2. Translate ONLY the text after the [number] prefix
3. Keep translations concise - subtitles have limited screen time
4. Maintain the tone and style appropriate for the content
5. Each line is a separate subtitle - translate them independently but with context awareness
6. Return ONLY the translated lines with their [number] prefixes, no additional text

Example format:
[0] Original text here
[1] Another subtitle

Should return:
[0] Translated text here
[1] Another translated subtitle`;

    const userPrompt = `Translate these subtitles:\n\n${segmentsText}`;

    try {
      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o-mini', // Fast and cost-effective for translation
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3, // Lower temperature for more consistent translations
      });

      const translatedText = completion.choices[0].message.content.trim();

      // Parse the translated text back into segments
      const translatedLines = translatedText.split('\n').filter(line => line.trim());
      const translatedSegments = [];

      for (const line of translatedLines) {
        const match = line.match(/^\[(\d+)\]\s*(.+)$/);
        if (match) {
          const index = parseInt(match[1]);
          const text = match[2].trim();

          if (segments[index]) {
            translatedSegments.push({
              id: segments[index].id,
              start: segments[index].start,
              end: segments[index].end,
              text: text,
              tokens: segments[index].tokens || [],
              confidence: segments[index].confidence || null
            });
          }
        }
      }

      // Fallback: if parsing failed, use original segments with warning
      if (translatedSegments.length !== segments.length) {
        debug(`Warning: Translation parsing mismatch (got ${translatedSegments.length}, expected ${segments.length})`);
        console.log('  ⚠️  Some segments may not have translated correctly, using originals as fallback');

        // Fill in any missing translations with originals
        const finalSegments = [];
        for (let i = 0; i < segments.length; i++) {
          finalSegments.push(translatedSegments[i] || { ...segments[i] });
        }
        return finalSegments;
      }

      return translatedSegments;

    } catch (error) {
      debug('Translation error:', error);

      if (error.status === 401) {
        throw new Error('OpenAI API authentication failed. Please check your OPENAI_API_KEY.');
      }

      if (error.status === 429) {
        throw new Error('OpenAI API rate limit exceeded. Please try again later.');
      }

      throw new Error(`Translation failed: ${error.message}`);
    }
  }

  /**
   * Get full language name from code
   * @param {string} code - Language code
   * @returns {string} Full language name
   */
  _getLanguageName(code) {
    const languages = {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ja': 'Japanese',
      'ko': 'Korean',
      'zh': 'Chinese',
      'ru': 'Russian',
      'ar': 'Arabic',
      'hi': 'Hindi',
      'nl': 'Dutch',
      'pl': 'Polish',
      'tr': 'Turkish',
      'vi': 'Vietnamese',
      'th': 'Thai',
      'sv': 'Swedish',
      'da': 'Danish',
      'no': 'Norwegian',
      'fi': 'Finnish'
    };

    return languages[code.toLowerCase()] || code;
  }

  /**
   * Estimate translation cost
   * Using GPT-4o-mini pricing
   * @param {number} segmentCount - Number of segments to translate
   * @param {number} avgCharsPerSegment - Average characters per segment
   * @returns {Object} Cost estimation
   */
  estimateCost(segmentCount, avgCharsPerSegment = 50) {
    // Rough token estimation: ~4 chars per token
    const inputTokens = (segmentCount * avgCharsPerSegment) / 4;
    const outputTokens = inputTokens; // Similar length output

    // GPT-4o-mini pricing (as of 2024): $0.00015/1K input, $0.0006/1K output
    const inputCost = (inputTokens / 1000) * 0.00015;
    const outputCost = (outputTokens / 1000) * 0.0006;
    const totalCost = inputCost + outputCost;

    return {
      estimatedTokens: Math.round(inputTokens + outputTokens),
      cost: totalCost.toFixed(4),
      currency: 'USD'
    };
  }
}

module.exports = Translator;
