# AI Subtitle Generator – Architecture (Express + Postgres + Stripe)

This document is written to **match the style of your existing repo** (`app.js` bootstraps a root handler class, and `lib/*` is class-based services like `Postgres.js`, `Redis.js`, etc.).

The goal is a **pay-on-demand** subtitle generator for Plex/self-hosted users:
- client extracts audio (ffmpeg.wasm)
- backend transcribes with Whisper
- results stored in R2
- caching/dedupe by audio hash
- **charge credits even on cache hits**
- ledger-based accounting in Postgres

---

## 1) High-level runtime shape

**Entry point**
- `app.js` loads env, instantiates a root class (similar to `new Haro({...})`), then calls `await handler.init()`

**Root handler responsibilities**
- read config + ensure tmp/output dirs
- initialize services (Postgres, Stripe, R2, Queue/Worker, Express API)
- bootstrap Postgres schema (like your namespace bootstrap pattern)
- expose `eventEmitter` for cross-service events

---

## 2) Proposed repo layout (mirrors your `lib/*` approach)

```
app.js
config.json
lib/
  SubtitleApp.js                 # root handler (Haro-equivalent)
  ExpressApi.js                  # express server + route wiring
  Postgres.js                    # pool + query wrapper + migrations/bootstrap helpers
  Stripe.js                      # checkout session + webhook verification + idempotent crediting
  R2.js                          # object store wrapper (put/get/head, presigned uploads)
  Credits.js                     # credit ledger operations (balance, debit, credit)
  Jobs.js                        # create/update job records + job status
  MediaCache.js                  # cache lookups/upserts by audio hash + lang + mode
  Whisper.js                     # transcription/translation pipeline + formatting
  SubtitleFormatter.js           # SRT/VTT segmentation rules, line breaking, timestamps
  Queue.js                       # queue abstraction (BullMQ/pg-boss/sqs/etc)
  Worker.js                      # consumes queue, runs Whisper, stores artifacts, charges credits
  Auth.js                        # session/jwt/api-key auth (minimal)
  RateLimit.js                   # per-user limits (minutes/hour, concurrent jobs)
  Utils.js
sql/
  bootstrap.sql                  # schema/table/index creation (or migrations/ folder)
```

This matches your style:
- each service is a class in `lib/`
- each service receives the root handler in the constructor: `new Service(this, options)`
- each service has `init()`
- the root handler coordinates initialization order

---

## 3) Root handler: `lib/SubtitleApp.js`

### Constructor state (pattern from `Haro.js`)
- `this.appRootPath`
- `this.configPath`
- `this.tmpFileDir`
- `this.outputFileDir`
- `this.config`
- `this.eventEmitter = new events.EventEmitter()`
- service handles:
  - `this.postgres`
  - `this.stripe`
  - `this.r2`
  - `this.queue`
  - `this.worker`
  - `this.api`

### init() ordering
Recommended init order (keeps failures obvious):
1. `_configHandler()`
2. `_initializeTmpDir()` / `_initializeOutputDir()`
3. `_initializePostgres()`
4. `_bootstrapPostgres()` (tables/indexes)
5. `_initializeR2()`
6. `_initializeStripe()`
7. `_initializeQueue()`
8. `_initializeWorker()` (optional in same process)
9. `_initializeExpressApi()`

A single-process “all-in-one” mode is fine early. Later you can run:
- API process (Express)
- Worker process (queue consumer)

---

## 4) Express API: `lib/ExpressApi.js`

### Responsibilities
- create express app
- apply middleware (json, auth, rate limiting)
- define routes
- start server

### Key routes (minimal MVP)
- `POST /auth/login` (optional if you use OAuth/JWT)
- `POST /checkout-session` -> Stripe Checkout (credit packs)
- `POST /stripe/webhook` -> verify signature, credit ledger
- `POST /jobs` -> create job + return presigned upload URL
- `GET /jobs/:id` -> job status + download URLs when ready
- `GET /jobs/:id/subtitles` -> returns SRT/VTT links (or streams)
- `POST /jobs/:id/cancel` (optional)

### `POST /jobs` flow (important)
Input:
- `audio_sha256` (computed client-side)
- `audio_seconds` (client-provided; backend may recompute or trust with limits)
- `language` (e.g. `en`, `ja`) — primary transcription language
- `additional_languages` (e.g. `['es', 'ko', 'ja']`) — optional, charged at 50% rate each
- `mode` (`transcribe` or `translate`)
- `format` (`srt`, `vtt`, or both)

Server logic:
1. authenticate user
2. rate limit check
3. compute `minutes_to_charge = ceil(audio_seconds / 60)` (or 15/30s rounding)
4. **create job record** (status = `awaiting_upload`)
5. return presigned R2 upload URL for `audio/{audio_sha256}.flac`
6. client uploads audio
7. client calls `POST /jobs/:id/enqueue` (or you auto-enqueue after upload confirm)

Cache check can happen either:
- at job creation (if audio already exists and cached subtitles exist), or
- in the worker (recommended so API stays fast)

Given your “charge even on cache hits” policy, the simplest is:
- always create job
- always enqueue
- worker decides cache-hit vs compute, but **always charges on success**

---

## 5) Postgres: `lib/Postgres.js` (mirror your existing wrapper)

Keep the same ergonomics you already like:
- Pool config and a `query(sql, params)` method
- logging knobs via env (slow queries, param logging, etc.)
- `init()` runs `SELECT 1`
- helper methods for bootstrap/migrations

### Tables (ledger-based)
Use a ledger (never a single balance column) so you can reconcile disputes.

**users**
- `id uuid pk`
- `email text unique`
- `password_hash text`
- `created_at timestamptz`

**credit_packs**
- `id text pk`
- `name text`
- `minutes_amount int`
- `price_cents int`
- `active bool`

**purchases**
- `id uuid pk`
- `user_id uuid`
- `provider text`
- `provider_checkout_session_id text unique`
- `provider_payment_intent_id text`
- `pack_id text`
- `price_cents int`
- `currency text`
- `status text`
- `created_at timestamptz`

**credit_ledger**
- `id uuid pk`
- `user_id uuid`
- `type text`  -- purchase | job_debit | refund | promo | adjustment
- `minutes_delta int`
- `job_id uuid null`
- `purchase_id uuid null`
- `note text null`
- `created_at timestamptz`

**jobs**
- `id uuid pk`
- `user_id uuid`
- `status text` -- awaiting_upload|queued|running|succeeded|failed
- `audio_sha256 text`
- `audio_object_key text`
- `audio_seconds int`
- `minutes_charged int`
- `cached_hit bool`
- `language text`
- `mode text`
- `model text`
- `error_code text null`
- `error_message text null`
- `created_at timestamptz`
- `started_at timestamptz null`
- `finished_at timestamptz null`

**subtitles**
- `id uuid pk`
- `job_id uuid`
- `format text` -- srt|vtt
- `object_key text`
- `sha256 text`
- `created_at timestamptz`

**media_cache**
- `audio_sha256 text`
- `language text`
- `mode text`
- `subtitle_srt_key text null`
- `subtitle_vtt_key text null`
- `transcript_key text null`
- `created_at timestamptz`
- `last_accessed_at timestamptz`
- `hit_count int`
- **unique(audio_sha256, language, mode)**

### Critical constraints (idempotency)
- `purchases.provider_checkout_session_id` UNIQUE
- `credit_ledger`: prevent double-debit for a job:
  - UNIQUE `(type, job_id)` where `type='job_debit'`
- `media_cache` unique tuple above

---

## 6) Stripe: `lib/Stripe.js`

### Responsibilities
- create checkout sessions for predefined `credit_packs`
- verify webhook signatures
- idempotently credit user ledger on `checkout.session.completed`

### Webhook handling (must be idempotent)
On webhook:
1. verify signature
2. check if session id already exists in `purchases`
3. if not exists:
   - insert `purchases` row (paid)
   - insert `credit_ledger` row (`type='purchase'`, `+minutes_amount`)

Store Stripe `event_id` too if you want extra safety.

---

## 7) R2 storage: `lib/R2.js`

### Object keys (deterministic)
- `audio/{audio_sha256}.flac`
- `subs/{audio_sha256}/{language}/{mode}.srt`
- `subs/{audio_sha256}/{language}/{mode}.vtt`
- `transcripts/{audio_sha256}/{language}/{mode}.json`

### Why deterministic keys
- easy `HEAD` checks
- cheap caching
- allows worker to skip duplicate writes

### Retention
- Keep subtitles long-term (small)
- Keep audio short-term (optional TTL) unless you expect frequent re-use

---

## 8) Caching + billing behavior

### Cache lookup key
`(audio_sha256, language, mode)`

### Policy
- If cached subtitles exist:
  - mark `jobs.cached_hit = true`
  - return cached files
  - **still charge minutes** on success

This means:
- compute cost goes down over time
- margins improve as cache grows
- user experience improves (fast returns)

---

## 9) Queue + Worker

### Queue choice
Any of these work:
- BullMQ (Redis)
- pg-boss (Postgres-backed)
- SQS (AWS)
- simple DB polling (MVP only)

Given you already have Postgres and want simple ops, **pg-boss** is a strong fit.

### Worker: `lib/Worker.js`
Worker consumes `transcribe_job` messages.

Processing steps:
1. `jobs.status = running`
2. cache check in DB (`media_cache`)
3. If hit:
   - ensure R2 objects exist (optional `HEAD`)
   - write `subtitles` rows (pointing to existing objects)
4. If miss:
   - download audio from R2
   - run `Whisper.transcribe()`
   - generate formatted SRT/VTT via `SubtitleFormatter`
   - upload artifacts to R2
   - upsert `media_cache`
   - insert `subtitles` rows
5. `jobs.status = succeeded`
6. **charge credits** (ledger debit) AFTER success
7. if failure:
   - `jobs.status = failed`
   - do NOT charge

### Charging (ledger debit)
`minutes_charged = ceil(audio_seconds / 60)` (or your rounding rule)

**Multi-language discount:**
- First language (Whisper transcription): full rate
- Each additional language (LLM translation): 50% rate
- Example: 22-min file in 3 languages = 22 + 11 + 11 = 44 minutes charged

```
base_minutes = ceil(audio_seconds / 60)
translation_count = max(0, requested_languages.length - 1)
total_minutes = base_minutes + (translation_count * ceil(base_minutes * 0.5))
```

Insert:
- `credit_ledger (type=’job_debit’, minutes_delta = -total_minutes, job_id=...)`

Because of the unique constraint, retries won’t double-debit.

---

## 10) Whisper + Formatting

### `lib/Whisper.js`
- wraps the transcription engine you already have
- inputs: audio file path or stream
- output: segments with start/end timestamps + text

### `lib/SubtitleFormatter.js` (this is where quality lives)
Rules worth enforcing:
- max characters per line (e.g. 42)
- max lines per caption (e.g. 2)
- min caption duration (e.g. 0.7s)
- avoid 1–2 word “flash” captions
- punctuation normalization (optional)

Outputs:
- SRT
- VTT

---

## 11) Auth + limits (keep MVP simple)

### Auth options
- Email+password + JWT
- OAuth (Google/Discord) if you want low friction
- API keys for a future CLI/agent

### Rate limiting
Add guardrails to prevent abuse:
- max concurrent jobs per user
- max minutes per job
- max minutes per day/hour

Log enforcement decisions for debugging.

---

## 12) Config + env vars (examples)

**Required**
- `DATABASE_URL` or discrete PG vars
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- `JWT_SECRET` (if using JWT)

**Optional**
- `PG_LOG_LEVEL=error|slow|all`
- `PG_SLOW_MS=500`
- `HARO_DEBUG_MODE=true` (same idea; you can rename)
- `MAX_MINUTES_PER_JOB=180`
- `MAX_CONCURRENT_JOBS=2`

---

## 13) Deployment modes

### Single process (MVP)
- Express API + Worker in one Node process

### Split (recommended after MVP)
- `api` process: Express only
- `worker` process: queue consumer only

Object storage and Postgres are shared.

---

## 14) Observability

Minimum useful logging:
- job lifecycle transitions
- cache hit rate
- minutes charged per job
- whisper runtime per minute
- failures by error_code

Metrics (optional):
- Prometheus/VictoriaMetrics counters:
  - `jobs_succeeded_total`
  - `jobs_failed_total`
  - `cache_hit_total`
  - `minutes_charged_total`

---

## 15) End-to-end flow (MVP)

1. User buys credits (Stripe Checkout → webhook → ledger credit)
2. User uploads video
3. Browser extracts audio (ffmpeg.wasm) + computes sha256
4. `POST /jobs` → create job + get presigned upload URL
5. Client uploads `audio/{sha}.flac` to R2
6. Client triggers enqueue
7. Worker:
   - cache hit? return fast
   - else run Whisper
   - store subs + upsert cache
   - mark succeeded
   - debit credits
8. Client downloads SRT/VTT (CDN-cached)

---

## 16) Why this matches your existing style

Your current repo patterns:
- `app.js` is tiny and just boots a root class
- root class owns service instances (Postgres/Redis/etc.)
- services are classes with `init()` and are passed a handler reference
- bootstrap actions happen during init

This architecture keeps the same mental model:
- `SubtitleApp` is Haro-equivalent
- each “thing” lives in `lib/Thing.js` as a class
- Express and Worker are just services hanging off the root handler
