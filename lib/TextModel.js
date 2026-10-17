// lib/TextModel.js
//
// Shared access to the OpenAI text model used for name correction and
// translation, via the Responses API. Whisper transcription lives in
// Transcriber.js and is unaffected.
const debug = require('debug')('SubtitleGenerator:TextModel');
const OpenAI = require('openai');

// gpt-6-luna: OpenAI's replacement for gpt-4o / gpt-4o-mini (both shut down
// 2027-01-14). Override with OPENAI_TEXT_MODEL to trial another model.
const DEFAULT_MODEL = 'gpt-6-luna';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

function isRetryable(error) {
  const status = error.status || error.statusCode;
  return status === 429 || (status >= 500 && status < 600);
}

class TextModel {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY not found in environment variables. ' +
        'Please add it to your .env file or set it as an environment variable.'
      );
    }
    this.client = new OpenAI({ apiKey });
    this.model = process.env.OPENAI_TEXT_MODEL || DEFAULT_MODEL;
    debug('Text model: %s', this.model);
  }

  /**
   * One Responses API call, retried on 429/5xx.
   * Sampling parameters are deliberately absent: GPT-6 models reject
   * temperature/top_p unless reasoning effort is 'none'.
   * @param {object} opts
   * @param {string} opts.instructions - System-level instructions
   * @param {string} opts.input - User content
   * @param {string} [opts.effort='low'] - Reasoning effort: none|low|medium|high|xhigh|max
   * @param {{name: string, schema: object}} [opts.schema] - Strict JSON schema for the output
   * @param {string} opts.label - For logs
   * @returns {Promise<string|object>} Parsed object when `schema` is given, else text
   */
  async respond({ instructions, input, effort = 'low', schema, label }) {
    const request = {
      model: this.model,
      instructions,
      input,
      reasoning: { effort }
    };
    if (schema) {
      request.text = { format: { type: 'json_schema', name: schema.name, schema: schema.schema, strict: true } };
    }

    let response;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await this.client.responses.create(request);
        break;
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

    if (response.status === 'incomplete') {
      throw new Error(`${label}: response incomplete (${response.incomplete_details?.reason || 'unknown'})`);
    }
    const text = response.output_text || '';
    debug('%s: %d input / %d output tokens', label,
      response.usage?.input_tokens || 0, response.usage?.output_tokens || 0);
    return schema ? JSON.parse(text) : text;
  }
}

module.exports = TextModel;
