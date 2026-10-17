// test/transcriber.test.js
//
// Provider fallback in Transcriber.transcribeBuffer. No network or database:
// provider clients are stubbed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Transcriber = require('../lib/Transcriber');

function stubProvider(name, behavior) {
  const calls = [];
  return {
    calls,
    provider: {
      name,
      model: `${name}-model`,
      client: {
        audio: {
          transcriptions: {
            create: async (params) => {
              calls.push(params);
              return behavior(params);
            }
          }
        }
      }
    }
  };
}

const ok = (text) => () => ({
  text, language: 'english', duration: 2,
  segments: [{ id: 0, start: 0, end: 2, text }]
});
const fail = (status) => () => { throw Object.assign(new Error(`HTTP ${status}`), { status }); };

test('falls through to the next provider when the first fails', async () => {
  const t = new Transcriber({});
  const openai = stubProvider('openai', fail(400));
  const groq = stubProvider('groq', ok('from groq'));
  t.providers = [openai.provider, groq.provider];

  const result = await t.transcribeBuffer(Buffer.from('audio'), { language: 'en', prompt: 'prev' });
  assert.equal(result.segments[0].text, 'from groq');
  assert.equal(openai.calls.length, 1);
  assert.equal(groq.calls[0].model, 'groq-model');
  assert.equal(groq.calls[0].prompt, 'prev');
  assert.equal(groq.calls[0].response_format, 'verbose_json');
});

test('uses only the first provider when it succeeds', async () => {
  const t = new Transcriber({});
  const openai = stubProvider('openai', ok('from openai'));
  const groq = stubProvider('groq', ok('from groq'));
  t.providers = [openai.provider, groq.provider];

  const result = await t.transcribeBuffer(Buffer.from('audio'), { language: 'auto' });
  assert.equal(result.segments[0].text, 'from openai');
  assert.equal(groq.calls.length, 0);
  assert.equal(openai.calls[0].language, undefined); // 'auto' -> let Whisper detect
});

test('reports the last error when every provider fails', async () => {
  const t = new Transcriber({});
  t.providers = [stubProvider('openai', fail(400)).provider, stubProvider('groq', fail(413)).provider];
  await assert.rejects(t.transcribeBuffer(Buffer.from('audio'), {}), /Transcription failed: HTTP 413/);
});

test('init orders providers from TRANSCRIBE_PROVIDERS and skips unconfigured ones', async () => {
  const saved = { ...process.env };
  try {
    process.env.OPENAI_API_KEY = 'sk-x';
    process.env.GROQ_API_KEY = 'gsk-x';
    delete process.env.TRANSCRIBE_PROVIDERS;
    let t = new Transcriber({});
    await t.init();
    assert.deepEqual(t.providers.map(p => p.name), ['openai', 'groq']);
    assert.equal(t.model, 'whisper-1');

    process.env.TRANSCRIBE_PROVIDERS = 'groq,openai';
    t = new Transcriber({});
    await t.init();
    assert.deepEqual(t.providers.map(p => `${p.name}/${p.model}`), ['groq/whisper-large-v3', 'openai/whisper-1']);

    delete process.env.GROQ_API_KEY;
    t = new Transcriber({});
    await t.init();
    assert.deepEqual(t.providers.map(p => p.name), ['openai']);
  } finally {
    process.env = saved;
  }
});
