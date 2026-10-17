// test/pipeline.test.js
//
// Integration tests for the job pipeline and credit accounting: real Postgres,
// real Express routes, real ffmpeg/ffprobe; OpenAI (Whisper, translation,
// correction) and R2 are stubbed so the suite costs nothing to run.
//
//   docker run -d --name syncscribe-test-pg -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=syncscribe -p 55432:5432 postgres:16
//   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/syncscribe npm test
//
// The database is wiped and re-bootstrapped. Never point this at production.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

const DB_URL = process.env.TEST_DATABASE_URL;
const PORT = 38123;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.DATABASE_URL = DB_URL || '';
process.env.PG_SSL = 'false';
process.env.JWT_SECRET = 'test-secret';
process.env.OPENAI_API_KEY = 'sk-test-unused';
process.env.PORT = String(PORT);
process.env.NODE_ENV = 'test';

const Postgres = require('../lib/Postgres');
const Credits = require('../lib/Credits');
const Jobs = require('../lib/Jobs');
const MediaCache = require('../lib/MediaCache');
const RateLimit = require('../lib/RateLimit');
const Auth = require('../lib/Auth');
const Transcriber = require('../lib/Transcriber');
const SubtitleWriter = require('../lib/SubtitleWriter');
const Worker = require('../lib/Worker');
const ExpressApi = require('../lib/ExpressApi');

const skip = !DB_URL && 'TEST_DATABASE_URL not set';
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncscribe-test-'));

/** 48 kbps mono 16 kHz MP3 of a tone — the same encoding the client produces. */
function makeAudio(seconds, name) {
  const out = path.join(fixtureDir, name);
  execFileSync(ffmpegStatic, [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', out
  ]);
  const buffer = fs.readFileSync(out);
  return { buffer, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

const handler = {};
const r2Store = new Map();
const whisperCalls = [];
const translateCalls = [];
const correctCalls = [];
const enqueued = [];

before(async () => {
  if (skip) return;
  handler.postgres = new Postgres(handler);
  await handler.postgres.init();
  await handler.postgres.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await handler.postgres.bootstrap();
  // Running bootstrap twice must be a no-op (it runs on every app start).
  await handler.postgres.bootstrap();

  handler.credits = new Credits(handler);
  handler.jobs = new Jobs(handler);
  handler.mediaCache = new MediaCache(handler);
  handler.rateLimit = new RateLimit(handler);
  handler.auth = new Auth(handler);
  await handler.auth.init();
  handler.subtitleWriter = new SubtitleWriter(handler);

  handler.r2 = Object.assign(Object.create(require('../lib/R2').prototype), {
    uploadBuffer: async (key, buffer) => { r2Store.set(key, Buffer.from(buffer)); },
    downloadBuffer: async (key) => {
      if (!r2Store.has(key)) throw new Error(`missing ${key}`);
      return r2Store.get(key);
    }
  });

  handler.transcriber = new Transcriber(handler);
  handler.transcriber.transcribeBuffer = async (buffer, opts) => {
    whisperCalls.push({ bytes: buffer.length, ...opts });
    const n = whisperCalls.length;
    return {
      text: `chunk ${n} text`,
      language: 'english',
      duration: 0,
      segments: [
        { id: 1, start: 0, end: 2, text: `chunk ${n} first` },
        { id: 2, start: 3, end: 5, text: `chunk ${n} second` }
      ]
    };
  };
  handler.translator = {
    translateSegments: async (segments, target, source, media) => {
      translateCalls.push({ target, media });
      return segments.map(s => ({ ...s, text: `[${target}] ${s.text}` }));
    }
  };
  // Identifies anything whose file name mentions "bebop"; leaves the rest alone.
  handler.corrector = {
    correctSegments: async (segments, hints) => {
      correctCalls.push(hints);
      if (!/bebop/i.test(hints.fileName || '')) {
        return { segments, identification: { identified: false, confidence: 'low', title: null }, names: [] };
      }
      return {
        segments: segments.map(s => ({ ...s, text: `${s.text} (corrected)` })),
        identification: { identified: true, confidence: 'high', title: 'Cowboy Bebop' },
        names: ['Spike Spiegel']
      };
    }
  };

  handler.worker = new Worker(handler);
  handler.worker.enqueue = async (jobId) => { enqueued.push(jobId); return 'pgboss-id'; };

  handler.api = new ExpressApi(handler);
  await handler.api.init();
});

after(async () => {
  if (skip) return;
  clearInterval(handler.jobs._cleanupInterval);
  handler.api.server.close();
  await handler.postgres.close();
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

beforeEach(() => {
  whisperCalls.length = 0;
  translateCalls.length = 0;
  correctCalls.length = 0;
});

let userCounter = 0;
async function makeUser(minutes) {
  userCounter++;
  const { rows } = await handler.postgres.query(
    `INSERT INTO users (google_id, email, name) VALUES ($1, $2, 'Test') RETURNING id, email`,
    [`g-${userCounter}-${Date.now()}`, `user${userCounter}-${Date.now()}@example.com`]
  );
  const user = rows[0];
  if (minutes) {
    await handler.postgres.query(
      `INSERT INTO credit_ledger (user_id, type, minutes_delta, note) VALUES ($1, 'adjustment', $2, 'test')`,
      [user.id, minutes]
    );
  }
  return { ...user, token: handler.auth.generateJWT(user) };
}

async function api(user, method, url, body, raw) {
  const headers = { Authorization: `Bearer ${user.token}` };
  let payload;
  if (raw) {
    payload = raw;
    headers['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${url}`, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function createJob(user, audio, extra = {}) {
  return api(user, 'POST', '/api/jobs', {
    audio_sha256: audio.sha256,
    audio_seconds: 60,
    language: 'en',
    ...extra
  });
}

/** Create → upload → enqueue → run the worker inline. Returns the job row. */
async function runJob(user, audio, extra = {}) {
  const created = await createJob(user, audio, extra);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const jobId = created.body.job.id;
  const up = await api(user, 'POST', `/api/jobs/${jobId}/upload`, undefined, audio.buffer);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const enq = await api(user, 'POST', `/api/jobs/${jobId}/enqueue`);
  assert.equal(enq.status, 200, JSON.stringify(enq.body));
  await handler.worker._processJob({ data: { jobId } });
  return handler.jobs.getById(jobId);
}

async function balance(user) {
  return handler.credits.getBalance(user.id);
}

let shortAudio;
let longAudio;
before(() => {
  if (skip) return;
  shortAudio = makeAudio(90, 'short.mp3');   // 90 s -> 2 minutes
  longAudio = makeAudio(150, 'long.mp3');    // 150 s -> 3 minutes, used for chunking
});

test('happy path bills on server-measured duration, not the client claim', { skip }, async () => {
  const user = await makeUser(100);
  // Client claims 1 second; server measures ~90 s.
  const job = await runJob(user, shortAudio, { audio_seconds: 1 });
  assert.equal(job.status, 'succeeded');
  assert.equal(job.audio_seconds >= 89 && job.audio_seconds <= 92, true, `audio_seconds=${job.audio_seconds}`);
  assert.equal(job.minutes_charged, 2);
  assert.equal(job.minutes_reserved, null);
  assert.equal(await balance(user), 98);
  assert.equal(whisperCalls.length, 1);
});

test('create rejects bad input', { skip }, async () => {
  const user = await makeUser(100);
  const cases = [
    { audio_sha256: 'nothex', audio_seconds: 60, language: 'en' },
    { audio_sha256: shortAudio.sha256, audio_seconds: -600, language: 'en' },
    { audio_sha256: shortAudio.sha256, audio_seconds: '60', language: 'en' },
    { audio_sha256: shortAudio.sha256, audio_seconds: 60, language: 'xx' },
    { audio_sha256: shortAudio.sha256, audio_seconds: 60, language: 'en', additional_languages: 'esfrde' },
    { audio_sha256: shortAudio.sha256, audio_seconds: 60, language: 'en', additional_languages: ['es', '../x'] },
    { audio_sha256: shortAudio.sha256, audio_seconds: 13 * 3600, language: 'en' }
  ];
  for (const body of cases) {
    const res = await api(user, 'POST', '/api/jobs', body);
    assert.ok(res.status === 400 || res.status === 413, `${JSON.stringify(body)} -> ${res.status}`);
  }
  // Float seconds are rounded up rather than 500ing on the INTEGER column.
  const ok = await createJob(user, shortAudio, { audio_seconds: 12.5 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.job.audio_seconds, 13);
});

test('upload with mismatched hash is rejected', { skip }, async () => {
  const user = await makeUser(100);
  const created = await createJob(user, shortAudio);
  const res = await api(user, 'POST', `/api/jobs/${created.body.job.id}/upload`, undefined, longAudio.buffer);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /does not match/);
});

test('enqueue requires an upload and only enqueues once', { skip }, async () => {
  const user = await makeUser(100);
  const created = await createJob(user, shortAudio);
  const jobId = created.body.job.id;

  const early = await api(user, 'POST', `/api/jobs/${jobId}/enqueue`);
  assert.equal(early.status, 409);

  await api(user, 'POST', `/api/jobs/${jobId}/upload`, undefined, shortAudio.buffer);
  enqueued.length = 0;
  const results = await Promise.all([
    api(user, 'POST', `/api/jobs/${jobId}/enqueue`),
    api(user, 'POST', `/api/jobs/${jobId}/enqueue`),
    api(user, 'POST', `/api/jobs/${jobId}/enqueue`)
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409, 409]);
  assert.equal(enqueued.filter(id => id === jobId).length, 1);

  // Duplicate worker delivery: the second run must not fail or double-charge.
  await handler.worker._processJob({ data: { jobId } });
  await handler.worker._processJob({ data: { jobId } });
  const job = await handler.jobs.getById(jobId);
  assert.equal(job.status, 'succeeded');
  assert.equal(await balance(user), 98);
  const subs = await handler.postgres.query('SELECT COUNT(*)::int AS n FROM subtitles WHERE job_id = $1', [jobId]);
  assert.equal(subs.rows[0].n, 2);
});

test('insufficient credits after measuring real duration -> 402', { skip }, async () => {
  const user = await makeUser(1);
  const created = await createJob(user, shortAudio, { audio_seconds: 30 });
  assert.equal(created.status, 201);
  const up = await api(user, 'POST', `/api/jobs/${created.body.job.id}/upload`, undefined, shortAudio.buffer);
  assert.equal(up.status, 402);
  assert.equal(up.body.error, 'Insufficient credits');
});

test('concurrent job creation cannot overspend credits', { skip }, async () => {
  const user = await makeUser(4); // enough for two 2-minute jobs
  const results = await Promise.all([1, 2, 3].map(() => createJob(user, shortAudio, { audio_seconds: 90 })));
  const statuses = results.map(r => r.status).sort();
  assert.deepEqual(statuses, [201, 201, 402]);
});

test('name correction runs automatically from file-name hints, feeds translation, and survives cache hits', { skip }, async () => {
  const user = await makeUser(100);
  const audio = makeAudio(45, 'bebop.mp3');
  const first = await runJob(user, audio, {
    file_name: '[Grp] Cowboy Bebop - 05.mkv', media_title: 'Ballad of Fallen Angels', additional_languages: ['es']
  });
  assert.equal(first.status, 'succeeded');
  assert.equal(first.source_name, '[Grp] Cowboy Bebop - 05.mkv');
  assert.equal(first.detected_title, 'Cowboy Bebop');
  assert.deepEqual(correctCalls, [{ fileName: '[Grp] Cowboy Bebop - 05.mkv', mediaTitle: 'Ballad of Fallen Angels' }]);
  assert.deepEqual(translateCalls, [{ target: 'es', media: { title: 'Cowboy Bebop', names: ['Spike Spiegel'] } }]);
  const { rows } = await handler.postgres.query(
    `SELECT object_key FROM subtitles WHERE job_id = $1 AND language = 'en' AND format = 'srt'`, [first.id]
  );
  assert.match(r2Store.get(rows[0].object_key).toString(), /corrected/);

  // Same audio, new translation language: cached primary, no second correction,
  // but the translation still gets the identified title and glossary.
  translateCalls.length = 0;
  const again = await runJob(user, audio, { file_name: 'renamed.mkv', additional_languages: ['fr'] });
  assert.equal(again.cached_hit, true);
  assert.equal(correctCalls.length, 1);
  assert.equal(again.detected_title, 'Cowboy Bebop');
  assert.deepEqual(translateCalls, [{ target: 'fr', media: { title: 'Cowboy Bebop', names: ['Spike Spiegel'] } }]);

  // Unidentified audio: no detected title, empty translation context.
  translateCalls.length = 0;
  const plain = await runJob(user, makeAudio(20, 'plain.mp3'), { file_name: 'lecture.mp4', additional_languages: ['de'] });
  assert.equal(plain.detected_title, null);
  assert.deepEqual(translateCalls, [{ target: 'de', media: {} }]);
});

test('old clients sending series_context still work (field ignored)', { skip }, async () => {
  const user = await makeUser(100);
  const res = await createJob(user, shortAudio, { series_context: 'x'.repeat(5000) });
  assert.equal(res.status, 201);
});

test('translations are cached per source and never served as a primary transcription', { skip }, async () => {
  const user = await makeUser(100);
  const audio = makeAudio(61, 'translate.mp3'); // distinct hash, 2 minutes
  const job = await runJob(user, audio, { additional_languages: ['es', 'es', 'en'] });
  assert.equal(job.status, 'succeeded');
  assert.deepEqual(translateCalls.map(c => c.target), ['es']); // deduped, primary removed
  assert.equal(job.minutes_charged, 2 + 1);

  // Primary 'es' for the same audio must transcribe, not reuse the translation.
  whisperCalls.length = 0;
  const es = await runJob(user, audio, { language: 'es' });
  assert.equal(es.cached_hit, false);
  assert.equal(whisperCalls.length, 1);
  assert.equal(es.minutes_charged, 2);
});

test('long audio is chunked and stitched with offset timestamps', { skip }, async () => {
  const user = await makeUser(100);
  const t = handler.transcriber;
  const saved = [t.singleRequestMaxBytes, t.chunkTargetBytes];
  // ~150 s at 6 KB/s ≈ 900 KB; force ~60 s chunks.
  t.singleRequestMaxBytes = 100 * 1024;
  t.chunkTargetBytes = Math.floor(longAudio.buffer.length * 60 / 150);
  try {
    const job = await runJob(user, longAudio);
    assert.equal(job.status, 'succeeded', job.error_message);
    assert.equal(whisperCalls.length, 3);
    assert.equal(whisperCalls[0].prompt, undefined);
    assert.equal(whisperCalls[1].prompt, 'chunk 1 text');

    const { rows } = await handler.postgres.query(
      `SELECT object_key FROM subtitles WHERE job_id = $1 AND format = 'srt'`, [job.id]
    );
    const srt = r2Store.get(rows[0].object_key).toString();
    const blocks = srt.trim().split(/\r?\n\r?\n/);
    assert.equal(blocks.length, 6);
    // Third chunk starts ~120 s in: its first cue must be offset to 00:02:00.
    assert.match(blocks[4], /00:02:0\d,\d{3} -->/);
    assert.match(blocks[4], /chunk 3 first/);
  } finally {
    [t.singleRequestMaxBytes, t.chunkTargetBytes] = saved;
  }
});

test('failed job is not charged and releases its reservation', { skip }, async () => {
  const user = await makeUser(10);
  const audio = makeAudio(30, 'fail.mp3');
  const original = handler.transcriber.transcribeBuffer;
  handler.transcriber.transcribeBuffer = async () => { throw new Error('boom'); };
  try {
    const job = await runJob(user, audio);
    assert.equal(job.status, 'failed');
    assert.equal(job.minutes_reserved, null);
    assert.equal(await balance(user), 10);
    assert.equal(await handler.credits.getAvailable(user.id), 10);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'tmp', 'audio', `${job.id}.mp3`)), false);
  } finally {
    handler.transcriber.transcribeBuffer = original;
  }
});

test('stale running jobs expire and free their slot', { skip }, async () => {
  const user = await makeUser(100);
  const created = await createJob(user, shortAudio);
  const jobId = created.body.job.id;
  await handler.postgres.query(
    `UPDATE jobs SET status = 'running', started_at = NOW() - INTERVAL '4 hours' WHERE id = $1`, [jobId]
  );
  await handler.jobs.expireStaleJobs();
  const job = await handler.jobs.getById(jobId);
  assert.equal(job.status, 'failed');
  assert.equal(job.error_code, 'EXPIRED');
});

test('promo redemption respects max_redemptions under concurrency', { skip }, async () => {
  await handler.postgres.query(
    `INSERT INTO promo_codes (code, minutes_amount, max_redemptions) VALUES ('TWO', 5, 2)`
  );
  const users = await Promise.all([1, 2, 3, 4].map(() => makeUser(0)));
  const results = await Promise.all(users.map(u => api(u, 'POST', '/api/redeem-promo', { code: 'two' })));
  assert.equal(results.filter(r => r.status === 200).length, 2);

  const again = await api(users[results.findIndex(r => r.status === 200)], 'POST', '/api/redeem-promo', { code: 'TWO' });
  assert.equal(again.status, 409);
});

test('job-events token is scoped to one job and is not a session token', { skip }, async () => {
  const user = await makeUser(100);
  const a = (await createJob(user, shortAudio)).body.job.id;
  const b = (await createJob(user, shortAudio)).body.job.id;
  const { body } = await api(user, 'POST', `/api/jobs/${a}/events-token`);
  assert.ok(body.token);

  // Accepted for its own job's stream...
  const ctrl = new AbortController();
  const ok = await fetch(`${BASE}/api/jobs/${a}/events?access_token=${body.token}`, { signal: ctrl.signal });
  assert.equal(ok.status, 200);
  ctrl.abort();
  // ...but not for another job, and not as a bearer session token.
  const other = await fetch(`${BASE}/api/jobs/${b}/events?access_token=${body.token}`);
  assert.equal(other.status, 401);
  const asSession = await api({ token: body.token }, 'GET', '/api/credits');
  assert.equal(asSession.status, 401);
  // Session JWTs are no longer accepted in the query string.
  const sessionInQuery = await fetch(`${BASE}/api/jobs/${a}/events?access_token=${user.token}`);
  assert.equal(sessionInQuery.status, 401);
});

test('API errors carry an { error } message', { skip }, async () => {
  const user = await makeUser(0);
  const res = await createJob(user, shortAudio);
  assert.equal(res.status, 402);
  assert.equal(res.body.error, 'Insufficient credits');
});

test('Stripe refunds and disputes converge to the right clawback', { skip }, async () => {
  const Stripe = require('../lib/Stripe');
  const stripe = Object.assign(Object.create(Stripe.prototype), { handler });
  const user = await makeUser(0);
  const { rows } = await handler.postgres.query(
    `INSERT INTO purchases (user_id, provider_checkout_session_id, provider_payment_intent_id, pack_id, price_cents, status)
     VALUES ($1, 'cs_test', 'pi_test', 'season', 1299, 'completed') RETURNING id`,
    [user.id]
  );
  await handler.postgres.query(
    `INSERT INTO credit_ledger (user_id, type, minutes_delta, purchase_id) VALUES ($1, 'purchase', 400, $2)`,
    [user.id, rows[0].id]
  );
  const charge = (refunded) => ({ id: 'ch_test', payment_intent: 'pi_test', amount: 1299, amount_refunded: refunded });

  await stripe._reconcileCharge(charge(650), false, 'charge.refunded');
  await stripe._reconcileCharge(charge(650), false, 'charge.refunded'); // redelivery
  assert.equal(await balance(user), 400 - 200);

  await stripe._reconcileCharge(charge(650), true, 'charge.dispute.created');
  assert.equal(await balance(user), 0);

  await stripe._reconcileCharge(charge(650), false, 'charge.dispute.closed'); // won
  assert.equal(await balance(user), 200);

  await stripe._reconcileCharge(charge(1299), false, 'charge.refunded');
  assert.equal(await balance(user), 0);
  const status = await handler.postgres.query('SELECT status FROM purchases WHERE id = $1', [rows[0].id]);
  assert.equal(status.rows[0].status, 'refunded');
});
