// lib/ExpressApi.js
const debug = require('debug')('SubtitleGenerator:ExpressApi');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { LANGUAGES, AUTO_DETECT } = require('../shared/languages.js');

const SHA256_RE = /^[0-9a-f]{64}$/;
const LANGUAGE_CODES = new Set(LANGUAGES.map(l => l.code));
const PRIMARY_LANGUAGE_CODES = new Set([AUTO_DETECT.code, ...LANGUAGE_CODES]);
const MAX_ADDITIONAL_LANGUAGES = 10;
// 12 hours of audio. The client encodes 48 kbps mono MP3 (~6 KB/s), so the
// largest legitimate upload is ~260 MB; the upload is streamed to disk.
const MAX_AUDIO_SECONDS = 12 * 60 * 60;
const MAX_UPLOAD_BYTES = 350 * 1024 * 1024;
const TMP_AUDIO_DIR = path.join(__dirname, '..', 'tmp', 'audio');

function tmpAudioPath(jobId) {
  return path.join(TMP_AUDIO_DIR, `${jobId}.mp3`);
}

class ExpressApi {
  constructor(handler) {
    this.handler = handler;
    this.app = null;
    this.server = null;
    this.port = parseInt(process.env.PORT, 10) || 3000;
  }

  async init() {
    debug('Initializing Express API');

    this.app = express();

    // Apache reverse-proxies from localhost; trust its X-Forwarded-* headers so
    // req.ip / req.protocol reflect the real client (rate limits, redirects).
    this.app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

    this._setupMiddleware();
    this._setupRoutes();
    this._setupErrorHandling();

    // Start listening
    await new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        debug('Express API listening on port %d', this.port);
        resolve();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Middleware
  // ---------------------------------------------------------------------------

  _setupMiddleware() {
    const allowedOrigins = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
      : ['http://localhost:5173', 'http://localhost:3000'];

    this.app.use(cors({
      origin: allowedOrigins,
      credentials: true
    }));

    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          mediaSrc: ["'self'", "blob:"],
          scriptSrc: ["'self'", "'wasm-unsafe-eval'", "blob:", "https://accounts.google.com", "https://apis.google.com"],
          workerSrc: ["'self'", "blob:"],
          frameSrc: ["'self'", "https://accounts.google.com"],
          connectSrc: ["'self'", "https://accounts.google.com", "https://*.r2.cloudflarestorage.com"],
          imgSrc: ["'self'", "data:", "blob:", "https://*.googleusercontent.com"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com"],
        }
      },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }));
    // Skip access logging for the high-frequency job-status reads and the
    // long-lived SSE stream — they otherwise bury every other log line. Errors
    // (4xx/5xx) on those routes are still logged, with tokens redacted.
    morgan.token('url', (req) => (req.originalUrl || req.url).replace(/([?&]access_token=)[^&]*/g, '$1REDACTED'));
    this.app.use(morgan('combined', {
      skip: (req, res) => {
        if (res.statusCode >= 400) return false;
        return req.method === 'GET' && /^\/api\/jobs\/[^/]+(\/events)?(\?.*)?$/.test(req.originalUrl);
      }
    }));
    this.app.use(cookieParser());

    // JSON body parser for all routes EXCEPT raw body routes
    this.app.use((req, res, next) => {
      if (req.originalUrl === '/api/stripe/webhook' || /^\/api\/jobs\/[^/]+\/upload$/.test(req.originalUrl)) {
        return next();
      }
      express.json({ limit: '1mb' })(req, res, next);
    });

    // Rate limiting
    this.app.use('/api/', this.handler.rateLimit.getMiddleware());

    debug('Middleware configured');
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  _setupRoutes() {
    const auth = this.handler.auth.authMiddleware();
    const jobLimiter = this.handler.rateLimit.getJobRateLimiter();

    // ---- Auth routes (no JWT required) ------------------------------------

    this.app.post('/auth/google', (req, res, next) => this._handleGoogleAuth(req, res, next));

    // ---- Stripe webhook (raw body, no JWT) --------------------------------

    this.app.post(
      '/api/stripe/webhook',
      express.raw({ type: 'application/json' }),
      (req, res, next) => this._handleStripeWebhook(req, res, next)
    );

    // ---- Public API routes ------------------------------------------------

    this.app.get('/api/credit-packs', (req, res, next) => this._handleGetCreditPacks(req, res, next));

    // ---- Shared job routes (public, no auth) --------------------------------

    this.app.get('/api/shared/jobs/:id', (req, res, next) => this._handleGetSharedJob(req, res, next));
    this.app.get('/api/shared/jobs/:id/subtitles/:language/:format', (req, res, next) => this._handleGetSharedSubtitleUrl(req, res, next));
    this.app.get('/api/shared/jobs/:id/subtitles/:language/:format/content', (req, res, next) => this._handleGetSharedSubtitleContent(req, res, next));

    // ---- Protected API routes ---------------------------------------------

    this.app.get('/api/me', auth, (req, res, next) => this._handleGetMe(req, res, next));
    this.app.get('/api/credits', auth, (req, res, next) => this._handleGetCredits(req, res, next));
    this.app.post('/api/redeem-promo', auth, (req, res, next) => this._handleRedeemPromo(req, res, next));
    this.app.post('/api/checkout', auth, (req, res, next) => this._handleCheckout(req, res, next));
    this.app.post('/api/jobs', auth, jobLimiter, (req, res, next) => this._handleCreateJob(req, res, next));
    this.app.post('/api/jobs/:id/upload', auth, (req, res, next) => this._handleUploadAudio(req, res, next));
    this.app.post('/api/jobs/:id/enqueue', auth, (req, res, next) => this._handleEnqueueJob(req, res, next));
    this.app.post('/api/jobs/:id/events-token', auth, (req, res, next) => this._handleJobEventsToken(req, res, next));
    this.app.get('/api/jobs/:id/events', this.handler.auth.authMiddleware({ allowJobEventsToken: true }), (req, res, next) => this._handleJobEvents(req, res, next));
    this.app.get('/api/jobs/:id', auth, (req, res, next) => this._handleGetJob(req, res, next));
    this.app.get('/api/jobs/:id/subtitles/:language/:format', auth, (req, res, next) => this._handleGetSubtitleUrl(req, res, next));
    this.app.get('/api/jobs/:id/subtitles/:language/:format/content', auth, (req, res, next) => this._handleGetSubtitleContent(req, res, next));
    this.app.get('/api/jobs', auth, (req, res, next) => this._handleListJobs(req, res, next));

    // ---- Static / SPA fallback (production) -------------------------------

    if (process.env.NODE_ENV === 'production') {
      const clientDist = path.resolve(__dirname, '..', 'client', 'dist');
      this.app.use(express.static(clientDist));

      // SPA fallback: serve index.html for client routes. Unknown API routes
      // and missing files (anything with an extension, e.g. /robots.txt before
      // it existed, /.env probes) get a real 404 instead of a 200 soft-404.
      this.app.get('*', (req, res) => {
        if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/auth/')) {
          return res.status(404).json({ error: 'Not found' });
        }
        if (/\.[^/]+$/.test(req.path)) {
          return res.status(404).type('text/plain').send('Not found');
        }
        res.sendFile(path.join(clientDist, 'index.html'));
      });
    }

    debug('Routes configured');
  }

  // ---------------------------------------------------------------------------
  // Route handlers
  // ---------------------------------------------------------------------------

  /**
   * POST /auth/google
   * Verify Google ID token, find/create user, return JWT + user.
   */
  async _handleGoogleAuth(req, res, next) {
    try {
      const credential = req.body.credential || req.body.id_token;

      if (!credential) {
        return res.status(400).json({ error: 'credential is required' });
      }

      const googlePayload = await this.handler.auth.verifyGoogleToken(credential);
      const user = await this.handler.auth.findOrCreateUser(googlePayload);
      const token = this.handler.auth.generateJWT(user);

      debug('Google auth succeeded for user %s', user.id);

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture,
          created_at: user.created_at
        }
      });
    } catch (error) {
      debug('Google auth error: %s', error.message);
      res.status(401).json({ error: error.message });
    }
  }

  /**
   * GET /api/me
   * Get current authenticated user.
   */
  async _handleGetMe(req, res, next) {
    try {
      const sql = 'SELECT id, email, name, picture, created_at FROM users WHERE id = $1';
      const result = await this.handler.postgres.query(sql, [req.user.id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/credits
   * Get credit balance for the authenticated user.
   */
  async _handleGetCredits(req, res, next) {
    try {
      const balance = await this.handler.credits.getBalance(req.user.id);
      res.json({ balance });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/credit-packs
   * Get available credit packs (public).
   */
  async _handleGetCreditPacks(req, res, next) {
    try {
      const sql = 'SELECT id, name, minutes_amount, price_cents FROM credit_packs WHERE active = true ORDER BY price_cents ASC';
      const result = await this.handler.postgres.query(sql);
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/redeem-promo
   * Redeem a promo code for free credits.
   * Body: { code }
   */
  async _handleRedeemPromo(req, res, next) {
    try {
      const { code } = req.body || {};

      if (!code || typeof code !== 'string' || !code.trim()) {
        return res.status(400).json({ error: 'code is required' });
      }

      const trimmedCode = code.trim().toUpperCase();

      // One transaction: the row lock on the promo code serializes redemptions so
      // max_redemptions can't be overshot, and the redemption and credit commit
      // together (a failed credit no longer burns the user's redemption).
      const outcome = await this.handler.postgres.withTransaction(async (client) => {
        const promoResult = await client.query(
          'SELECT * FROM promo_codes WHERE code = $1 FOR UPDATE',
          [trimmedCode]
        );

        if (promoResult.rows.length === 0) {
          return { status: 404, body: { error: 'Invalid promo code' } };
        }

        const promo = promoResult.rows[0];

        if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
          return { status: 410, body: { error: 'This promo code has expired' } };
        }

        if (promo.max_redemptions !== null) {
          const countResult = await client.query(
            'SELECT COUNT(*)::int AS cnt FROM promo_redemptions WHERE code = $1',
            [trimmedCode]
          );
          if (countResult.rows[0].cnt >= promo.max_redemptions) {
            return { status: 409, body: { error: 'This promo code has reached its redemption limit' } };
          }
        }

        // UNIQUE (user_id, code) prevents double-redeem
        const inserted = await client.query(
          `INSERT INTO promo_redemptions (user_id, code) VALUES ($1, $2)
           ON CONFLICT (user_id, code) DO NOTHING
           RETURNING id`,
          [req.user.id, trimmedCode]
        );
        if (inserted.rows.length === 0) {
          return { status: 409, body: { error: 'You have already redeemed this promo code' } };
        }

        await this.handler.credits.creditPromo(req.user.id, trimmedCode, promo.minutes_amount, client);
        return { minutes: promo.minutes_amount };
      });

      if (outcome.status) {
        return res.status(outcome.status).json(outcome.body);
      }

      const balance = await this.handler.credits.getBalance(req.user.id);

      debug('Promo %s redeemed by user %s: %d minutes', trimmedCode, req.user.id, outcome.minutes);

      res.json({ minutes_granted: outcome.minutes, balance });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/checkout
   * Create a Stripe checkout session.
   * Body: { pack_id, success_url, cancel_url }
   */
  async _handleCheckout(req, res, next) {
    try {
      const { pack_id } = req.body;
      const origin = `${req.protocol}://${req.get('host')}`;
      // Only same-origin redirect targets; anything else falls back to the default.
      const sameOrigin = (url) => {
        try { return new URL(url).origin === origin; } catch { return false; }
      };
      const success_url = sameOrigin(req.body.success_url) ? req.body.success_url : `${origin}/?checkout=success`;
      const cancel_url = sameOrigin(req.body.cancel_url) ? req.body.cancel_url : `${origin}/?checkout=cancel`;

      if (!pack_id) {
        return res.status(400).json({ error: 'pack_id is required' });
      }

      // Fetch the credit pack
      const packResult = await this.handler.postgres.query(
        'SELECT * FROM credit_packs WHERE id = $1 AND active = true',
        [pack_id]
      );

      if (packResult.rows.length === 0) {
        return res.status(404).json({ error: 'Credit pack not found' });
      }

      // Create Stripe checkout session (purchase record created by webhook on payment)
      const session = await this.handler.stripe.createCheckoutSession(
        req.user.id, pack_id, success_url, cancel_url
      );

      debug('Checkout session created: %s for user %s', session.id, req.user.id);

      res.json({ url: session.url });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/stripe/webhook
   * Handle Stripe webhook events (raw body, no auth middleware).
   */
  async _handleStripeWebhook(req, res, next) {
    try {
      const sig = req.headers['stripe-signature'];

      if (!sig) {
        return res.status(400).json({ error: 'Missing stripe-signature header' });
      }

      // Delegate to the Stripe service which handles signature verification,
      // purchase recording, and credit allocation in a single transaction
      const result = await this.handler.stripe.handleWebhook(req.body, sig);

      debug('Stripe webhook processed: %j', result);

      res.json({ received: true });
    } catch (error) {
      debug('Stripe webhook error: %s', error.message);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * POST /api/jobs
   * Create a new job.
   * Body: { audio_sha256, audio_seconds, language, additional_languages, file_name?, media_title? }
   *
   * audio_seconds is the client's estimate and only sizes the initial credit
   * reservation; the upload handler re-measures the real duration.
   */
  async _handleCreateJob(req, res, next) {
    try {
      const { audio_sha256, language } = req.body;
      let { audio_seconds, additional_languages } = req.body;

      if (typeof audio_sha256 !== 'string' || !SHA256_RE.test(audio_sha256)) {
        return res.status(400).json({ error: 'audio_sha256 must be a lowercase hex SHA-256' });
      }
      if (typeof audio_seconds !== 'number' || !Number.isFinite(audio_seconds) || audio_seconds <= 0) {
        return res.status(400).json({ error: 'audio_seconds must be a positive number' });
      }
      audio_seconds = Math.ceil(audio_seconds);
      if (audio_seconds > MAX_AUDIO_SECONDS) {
        return res.status(413).json({ error: `Audio longer than ${MAX_AUDIO_SECONDS / 3600} hours is not supported` });
      }
      if (typeof language !== 'string' || !PRIMARY_LANGUAGE_CODES.has(language)) {
        return res.status(400).json({ error: 'Unsupported language' });
      }

      if (additional_languages == null) {
        additional_languages = [];
      }
      if (!Array.isArray(additional_languages)
        || !additional_languages.every(l => typeof l === 'string' && LANGUAGE_CODES.has(l))) {
        return res.status(400).json({ error: 'additional_languages must be a list of supported language codes' });
      }
      additional_languages = [...new Set(additional_languages)].filter(l => l !== language);
      if (additional_languages.length > MAX_ADDITIONAL_LANGUAGES) {
        return res.status(400).json({ error: `At most ${MAX_ADDITIONAL_LANGUAGES} translation languages per job` });
      }

      // Optional hints for automatic name correction. Free text that only ever
      // reaches the model as data; trimmed and length-capped, never rejected.
      const hint = (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : null);
      const source_name = hint(req.body.file_name);
      const media_title = hint(req.body.media_title);

      const minutesNeeded = this.handler.credits.calculateJobCost(audio_seconds, additional_languages.length);

      // Concurrency and credit checks plus the reservation run under a per-user
      // lock, so parallel requests can't each pass the check and overspend.
      const outcome = await this.handler.postgres.withTransaction(async (client) => {
        await this.handler.credits.lockUser(client, req.user.id);

        const concurrency = await this.handler.rateLimit.checkConcurrentJobs(req.user.id, client);
        if (!concurrency.allowed) {
          return {
            status: 429,
            body: { error: 'Too many concurrent jobs', active: concurrency.active, max: concurrency.max }
          };
        }

        const available = await this.handler.credits.getAvailable(req.user.id, { client });
        if (available < minutesNeeded) {
          return {
            status: 402,
            body: { error: 'Insufficient credits', balance: available, minutes_needed: minutesNeeded }
          };
        }

        const job = await this.handler.jobs.create(req.user.id, {
          language,
          additional_languages: additional_languages.length > 0 ? additional_languages : null,
          source_name,
          media_title,
          model: this.handler.transcriber && this.handler.transcriber.model,
          audio_sha256,
          audio_seconds,
          minutes_reserved: minutesNeeded
        }, client);
        return { job };
      });

      if (outcome.status) {
        return res.status(outcome.status).json(outcome.body);
      }

      const { job } = outcome;
      debug('Job created: %s for user %s', job.id, req.user.id);

      res.status(201).json({
        job: {
          id: job.id,
          status: 'awaiting_upload',
          audio_sha256,
          audio_seconds,
          language,
          additional_languages,
          minutes_estimated: minutesNeeded,
          created_at: job.created_at
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/jobs/:id/upload
   * Upload the extracted audio (MP3) for a job. Streams to a local temp file
   * (deleted after processing), verifies it hashes to the job's declared
   * audio_sha256, and measures its real duration with ffprobe. The credit
   * reservation is resized to the measured duration; that duration is what the
   * job is billed on.
   */
  async _handleUploadAudio(req, res, next) {
    const jobId = req.params.id;
    const partPath = `${tmpAudioPath(jobId)}.${crypto.randomBytes(4).toString('hex')}.part`;

    try {
      const job = await this.handler.jobs.getById(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (job.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (job.status !== 'awaiting_upload') {
        return res.status(409).json({ error: `Job cannot accept upload in status '${job.status}'` });
      }

      const declaredLength = parseInt(req.get('content-length'), 10);
      if (declaredLength > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: 'Audio upload is too large' });
      }

      // Stream to disk while hashing. Past the size cap, keep draining (so the
      // client still receives the 413) but stop writing.
      fs.mkdirSync(TMP_AUDIO_DIR, { recursive: true });
      const hash = crypto.createHash('sha256');
      let bytes = 0;
      const meter = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          if (bytes > MAX_UPLOAD_BYTES) return callback();
          hash.update(chunk);
          callback(null, chunk);
        }
      });
      await pipeline(req, meter, fs.createWriteStream(partPath));

      if (bytes > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: 'Audio upload is too large' });
      }
      if (bytes === 0) {
        return res.status(400).json({ error: 'No audio data received' });
      }
      if (hash.digest('hex') !== job.audio_sha256) {
        return res.status(400).json({ error: 'Uploaded audio does not match the file this job was created for' });
      }

      let audioSeconds;
      try {
        audioSeconds = Math.ceil(await this.handler.transcriber.probeDuration(partPath));
      } catch (err) {
        debug('Duration probe failed for job %s: %s', jobId, err.message);
        return res.status(400).json({ error: 'Could not read the uploaded audio' });
      }
      if (audioSeconds > MAX_AUDIO_SECONDS) {
        return res.status(413).json({ error: `Audio longer than ${MAX_AUDIO_SECONDS / 3600} hours is not supported` });
      }

      const minutesNeeded = this.handler.credits.calculateJobCost(
        audioSeconds, (job.additional_languages || []).length
      );

      const outcome = await this.handler.postgres.withTransaction(async (client) => {
        await this.handler.credits.lockUser(client, req.user.id);

        const current = await client.query(
          'SELECT status FROM jobs WHERE id = $1 FOR UPDATE',
          [jobId]
        );
        if (current.rows[0].status !== 'awaiting_upload') {
          return { status: 409, body: { error: `Job cannot accept upload in status '${current.rows[0].status}'` } };
        }

        const available = await this.handler.credits.getAvailable(req.user.id, { excludeJobId: jobId, client });
        if (available < minutesNeeded) {
          return {
            status: 402,
            body: { error: 'Insufficient credits', balance: available, minutes_needed: minutesNeeded }
          };
        }

        fs.renameSync(partPath, tmpAudioPath(jobId));
        await client.query(
          `UPDATE jobs SET audio_seconds = $1, minutes_reserved = $2, audio_object_key = $3 WHERE id = $4`,
          [audioSeconds, minutesNeeded, `tmp:${jobId}`, jobId]
        );
        return {};
      });

      if (outcome.status) {
        return res.status(outcome.status).json(outcome.body);
      }

      debug('Audio saved for job %s: size=%d seconds=%d minutes=%d', jobId, bytes, audioSeconds, minutesNeeded);
      res.json({ ok: true, audio_seconds: audioSeconds, minutes_estimated: minutesNeeded });
    } catch (error) {
      next(error);
    } finally {
      fs.rm(partPath, { force: true }, () => {});
    }
  }

  /**
   * POST /api/jobs/:id/enqueue
   * Enqueue an uploaded job for processing (must own job).
   */
  async _handleEnqueueJob(req, res, next) {
    try {
      const jobId = req.params.id;

      // Atomic awaiting_upload -> queued, so a double-click or retry can't
      // enqueue the same job twice.
      const job = await this.handler.jobs.markQueued(jobId, req.user.id);

      if (!job) {
        const existing = await this.handler.jobs.getById(jobId);
        if (!existing) {
          return res.status(404).json({ error: 'Job not found' });
        }
        if (existing.user_id !== req.user.id) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        if (existing.status === 'awaiting_upload') {
          return res.status(409).json({ error: 'Upload the audio before enqueueing this job' });
        }
        return res.status(409).json({
          error: `Job cannot be enqueued from status '${existing.status}'`
        });
      }

      try {
        await this.handler.worker.enqueue(jobId, {
          audio_sha256: job.audio_sha256,
          language: job.language
        });
      } catch (err) {
        // Put the job back so the client can retry instead of it sitting in
        // 'queued' with nothing in the queue.
        await this.handler.postgres.query(
          `UPDATE jobs SET status = 'awaiting_upload' WHERE id = $1 AND status = 'queued'`,
          [jobId]
        );
        throw err;
      }

      debug('Job %s enqueued by user %s', jobId, req.user.id);

      res.json({ id: jobId, status: 'queued' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/jobs/:id/events-token
   * Issue a short-lived token scoped to this job's SSE stream (must own job).
   * The client passes it as ?access_token= because EventSource can't set headers.
   */
  async _handleJobEventsToken(req, res, next) {
    try {
      const job = await this.handler.jobs.getById(req.params.id);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      if (job.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      res.json({ token: this.handler.auth.generateJobEventsToken(req.user, job.id) });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/jobs/:id
   * Get job status (must own job). Includes subtitles if succeeded.
   */
  async _handleGetJob(req, res, next) {
    try {
      const jobId = req.params.id;
      const job = await this.handler.jobs.getById(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (job.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      res.json(await this._buildJobSnapshot(job));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Shape a job row into the public status payload (shared by the polling
   * endpoint and the SSE stream). Includes subtitles once succeeded.
   */
  async _buildJobSnapshot(job) {
    const snapshot = {
      id: job.id,
      status: job.status,
      stage: job.stage,
      audio_sha256: job.audio_sha256,
      audio_seconds: job.audio_seconds,
      language: job.language,
      additional_languages: job.additional_languages,
      minutes_charged: job.minutes_charged,
      cached_hit: job.cached_hit,
      detected_title: job.detected_title,
      error_code: job.error_code,
      error_message: job.error_message,
      created_at: job.created_at,
      started_at: job.started_at,
      finished_at: job.finished_at
    };

    if (job.status === 'succeeded') {
      const subtitleResult = await this.handler.postgres.query(
        'SELECT id, language, format, object_key, created_at FROM subtitles WHERE job_id = $1 ORDER BY language, format',
        [job.id]
      );
      snapshot.subtitles = subtitleResult.rows;
    }

    return snapshot;
  }

  /**
   * GET /api/jobs/:id/events
   * Server-Sent Events stream of job status/stage changes (must own job).
   * Pushes an initial snapshot, then forwards LISTEN/NOTIFY events until the job
   * reaches a terminal state, then closes. Replaces 2s client polling.
   *
   * EventSource cannot set an Authorization header, so this route also accepts
   * a job-scoped token (POST /api/jobs/:id/events-token) via ?access_token=.
   */
  async _handleJobEvents(req, res, next) {
    try {
      const jobId = req.params.id;
      const job = await this.handler.jobs.getById(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      if (job.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // SSE headers. X-Accel-Buffering disables proxy buffering where honored.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders?.();

      const send = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const isTerminal = (status) => status === 'succeeded' || status === 'failed' || status === 'cancelled';

      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      };

      const finish = async () => {
        // Re-read for the authoritative terminal snapshot (subtitles, charges).
        try {
          const fresh = await this.handler.jobs.getById(jobId);
          if (fresh) send(await this._buildJobSnapshot(fresh));
        } catch (err) {
          debug('SSE finish snapshot failed for %s: %s', jobId, err.message);
        }
        cleanup();
        res.end();
      };

      // Forward live events. NOTIFY payloads are partial ({status} or {stage});
      // re-read the row so the client always gets a complete, consistent snapshot.
      const onEvent = async () => {
        if (closed) return;
        try {
          const fresh = await this.handler.jobs.getById(jobId);
          if (!fresh) return;
          send(await this._buildJobSnapshot(fresh));
          if (isTerminal(fresh.status)) await finish();
        } catch (err) {
          debug('SSE event handler failed for %s: %s', jobId, err.message);
        }
      };

      const unsubscribe = this.handler.postgres.subscribeJobEvents(jobId, onEvent);

      // Heartbeat keeps the connection alive through idle proxies.
      const heartbeat = setInterval(() => {
        if (!closed) res.write(': ping\n\n');
      }, 15000);

      req.on('close', cleanup);

      // Initial snapshot — read fresh AFTER subscribing so we can't miss a
      // transition that landed between the auth lookup above and the subscribe.
      // If the job is already terminal, send it and close.
      const current = await this.handler.jobs.getById(jobId);
      const snapshot = await this._buildJobSnapshot(current || job);
      send(snapshot);
      if (isTerminal(snapshot.status)) {
        cleanup();
        return res.end();
      }
    } catch (error) {
      // Headers may already be sent; if so just tear down the stream.
      if (res.headersSent) {
        try { res.end(); } catch {}
      } else {
        next(error);
      }
    }
  }

  /**
   * GET /api/jobs/:id/subtitles/:language/:format
   * Get a presigned download URL for a subtitle file (must own job).
   */
  async _handleGetSubtitleUrl(req, res, next) {
    try {
      const { id: jobId, language, format } = req.params;

      if (!['srt', 'vtt'].includes(format)) {
        return res.status(400).json({ error: 'Format must be srt or vtt' });
      }

      const job = await this.handler.jobs.getById(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (job.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Find the subtitle record
      const subtitleResult = await this.handler.postgres.query(
        'SELECT * FROM subtitles WHERE job_id = $1 AND language = $2 AND format = $3',
        [jobId, language, format]
      );

      if (subtitleResult.rows.length === 0) {
        return res.status(404).json({ error: 'Subtitle not found' });
      }

      const subtitle = subtitleResult.rows[0];
      const baseName = (job.file_name || 'subtitles').replace(/\.[^.]+$/, '');
      const fileName = `${baseName}.${language}.${format}`;
      const downloadUrl = await this.handler.r2.getPresignedDownloadUrl(subtitle.object_key, 3600, fileName);

      res.json({ url: downloadUrl });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/jobs/:id/subtitles/:language/:format/content
   * Proxy subtitle file content from R2 (avoids CORS issues with presigned URLs).
   */
  async _handleGetSubtitleContent(req, res, next) {
    try {
      const { id: jobId, language, format } = req.params;

      if (!['srt', 'vtt'].includes(format)) {
        return res.status(400).json({ error: 'Format must be srt or vtt' });
      }

      const job = await this.handler.jobs.getById(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (job.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const subtitleResult = await this.handler.postgres.query(
        'SELECT * FROM subtitles WHERE job_id = $1 AND language = $2 AND format = $3',
        [jobId, language, format]
      );

      if (subtitleResult.rows.length === 0) {
        return res.status(404).json({ error: 'Subtitle not found' });
      }

      const subtitle = subtitleResult.rows[0];
      const buffer = await this.handler.r2.downloadBuffer(subtitle.object_key);
      const contentType = format === 'vtt' ? 'text/vtt' : 'application/x-subrip';
      res.setHeader('Content-Type', `${contentType}; charset=utf-8`);
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Shared job helpers & handlers (public, no auth)
  // ---------------------------------------------------------------------------

  async _validateSharedJob(jobId, res) {
    const job = await this.handler.jobs.getById(jobId);

    if (!job || job.status !== 'succeeded') {
      res.status(404).json({ error: 'Not found' });
      return null;
    }

    const expiresAt = new Date(new Date(job.created_at).getTime() + 7 * 24 * 60 * 60 * 1000);
    if (Date.now() > expiresAt.getTime()) {
      res.status(410).json({ error: 'This shared link has expired' });
      return null;
    }

    return { job, expiresAt };
  }

  async _handleGetSharedJob(req, res, next) {
    try {
      const result = await this._validateSharedJob(req.params.id, res);
      if (!result) return;

      const { job, expiresAt } = result;

      const subtitleResult = await this.handler.postgres.query(
        'SELECT id, language, format, created_at FROM subtitles WHERE job_id = $1 ORDER BY language, format',
        [job.id]
      );

      res.json({
        id: job.id,
        status: job.status,
        language: job.language,
        additional_languages: job.additional_languages,
        audio_seconds: job.audio_seconds,
        created_at: job.created_at,
        finished_at: job.finished_at,
        expires_at: expiresAt.toISOString(),
        subtitles: subtitleResult.rows
      });
    } catch (error) {
      next(error);
    }
  }

  async _handleGetSharedSubtitleUrl(req, res, next) {
    try {
      const { id: jobId, language, format } = req.params;

      if (!['srt', 'vtt'].includes(format)) {
        return res.status(400).json({ error: 'Format must be srt or vtt' });
      }

      const result = await this._validateSharedJob(jobId, res);
      if (!result) return;

      const { job } = result;

      const subtitleResult = await this.handler.postgres.query(
        'SELECT * FROM subtitles WHERE job_id = $1 AND language = $2 AND format = $3',
        [jobId, language, format]
      );

      if (subtitleResult.rows.length === 0) {
        return res.status(404).json({ error: 'Subtitle not found' });
      }

      const subtitle = subtitleResult.rows[0];
      const fileName = `subtitles.${language}.${format}`;
      const downloadUrl = await this.handler.r2.getPresignedDownloadUrl(subtitle.object_key, 3600, fileName);

      res.json({ url: downloadUrl });
    } catch (error) {
      next(error);
    }
  }

  async _handleGetSharedSubtitleContent(req, res, next) {
    try {
      const { id: jobId, language, format } = req.params;

      if (!['srt', 'vtt'].includes(format)) {
        return res.status(400).json({ error: 'Format must be srt or vtt' });
      }

      const result = await this._validateSharedJob(jobId, res);
      if (!result) return;

      const subtitleResult = await this.handler.postgres.query(
        'SELECT * FROM subtitles WHERE job_id = $1 AND language = $2 AND format = $3',
        [jobId, language, format]
      );

      if (subtitleResult.rows.length === 0) {
        return res.status(404).json({ error: 'Subtitle not found' });
      }

      const subtitle = subtitleResult.rows[0];
      const buffer = await this.handler.r2.downloadBuffer(subtitle.object_key);
      const contentType = format === 'vtt' ? 'text/vtt' : 'application/x-subrip';
      res.setHeader('Content-Type', `${contentType}; charset=utf-8`);
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/jobs
   * List the authenticated user's recent jobs.
   */
  async _handleListJobs(req, res, next) {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const jobsList = await this.handler.jobs.getByUser(req.user.id, limit);

      res.json({
        jobs: jobsList.map((job) => ({
          id: job.id,
          status: job.status,
          audio_sha256: job.audio_sha256,
          audio_seconds: job.audio_seconds,
          language: job.language,
          additional_languages: job.additional_languages,
          minutes_charged: job.minutes_charged,
          cached_hit: job.cached_hit,
          error_code: job.error_code,
          error_message: job.error_message,
          created_at: job.created_at,
          started_at: job.started_at,
          finished_at: job.finished_at
        }))
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  _setupErrorHandling() {
    // 404 handler for unmatched API routes
    this.app.use('/api/*', (req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Global error handler
    this.app.use((err, req, res, _next) => {
      debug('Unhandled error: %s', err.message);
      debug('Stack: %s', err.stack);

      const status = err.status || err.statusCode || 500;
      const message = process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message;

      res.status(status).json({ error: message });
    });

    debug('Error handling configured');
  }

  /**
   * Gracefully stop the HTTP server.
   */
  async stop() {
    if (this.server) {
      await new Promise((resolve, reject) => {
        this.server.close((err) => {
          if (err) return reject(err);
          debug('Express server stopped');
          resolve();
        });
      });
      this.server = null;
    }
  }
}

module.exports = ExpressApi;
