// lib/ExpressApi.js
const debug = require('debug')('SubtitleGenerator:ExpressApi');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');

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
    this.app.use(morgan('combined'));
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

    // ---- Protected API routes ---------------------------------------------

    this.app.get('/api/me', auth, (req, res, next) => this._handleGetMe(req, res, next));
    this.app.get('/api/credits', auth, (req, res, next) => this._handleGetCredits(req, res, next));
    this.app.post('/api/checkout', auth, (req, res, next) => this._handleCheckout(req, res, next));
    this.app.post('/api/jobs', auth, jobLimiter, (req, res, next) => this._handleCreateJob(req, res, next));
    this.app.post('/api/jobs/:id/upload', auth, express.raw({ type: '*/*', limit: '50mb' }), (req, res, next) => this._handleUploadAudio(req, res, next));
    this.app.post('/api/jobs/:id/enqueue', auth, (req, res, next) => this._handleEnqueueJob(req, res, next));
    this.app.get('/api/jobs/:id', auth, (req, res, next) => this._handleGetJob(req, res, next));
    this.app.get('/api/jobs/:id/subtitles/:language/:format', auth, (req, res, next) => this._handleGetSubtitleUrl(req, res, next));
    this.app.get('/api/jobs/:id/subtitles/:language/:format/content', auth, (req, res, next) => this._handleGetSubtitleContent(req, res, next));
    this.app.get('/api/jobs', auth, (req, res, next) => this._handleListJobs(req, res, next));

    // ---- Static / SPA fallback (production) -------------------------------

    if (process.env.NODE_ENV === 'production') {
      const clientDist = path.resolve(__dirname, '..', 'client', 'dist');
      this.app.use(express.static(clientDist));

      // SPA fallback: serve index.html for non-API routes
      this.app.get('*', (req, res) => {
        if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/auth/')) {
          return res.status(404).json({ error: 'Not found' });
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
   * POST /api/checkout
   * Create a Stripe checkout session.
   * Body: { pack_id, success_url, cancel_url }
   */
  async _handleCheckout(req, res, next) {
    try {
      const { pack_id } = req.body;
      const proto = req.get('x-forwarded-proto') || req.protocol;
      const origin = `${proto}://${req.get('host')}`;
      const success_url = req.body.success_url || `${origin}/?checkout=success`;
      const cancel_url = req.body.cancel_url || `${origin}/?checkout=cancel`;

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
   * Body: { audio_sha256, audio_seconds, language, additional_languages }
   */
  async _handleCreateJob(req, res, next) {
    try {
      const { audio_sha256, audio_seconds, language, additional_languages } = req.body;

      if (!audio_sha256 || !audio_seconds || !language) {
        return res.status(400).json({ error: 'audio_sha256, audio_seconds, and language are required' });
      }

      // Calculate cost and check credits
      const additionalCount = (additional_languages || []).length;
      const minutesNeeded = this.handler.credits.calculateJobCost(audio_seconds, additionalCount);

      const hasCredits = await this.handler.credits.hasEnoughCredits(req.user.id, minutesNeeded);
      if (!hasCredits) {
        const balance = await this.handler.credits.getBalance(req.user.id);
        return res.status(402).json({
          error: 'Insufficient credits',
          balance,
          minutes_needed: minutesNeeded
        });
      }

      // Check concurrent job limit
      const concurrency = await this.handler.rateLimit.checkConcurrentJobs(req.user.id);
      if (!concurrency.allowed) {
        return res.status(429).json({
          error: 'Too many concurrent jobs',
          active: concurrency.active,
          max: concurrency.max
        });
      }

      // Create job record
      const job = await this.handler.jobs.create(req.user.id, {
        language,
        additional_languages: additional_languages || null
      });

      // Update job with audio metadata
      await this.handler.jobs.updateStatus(job.id, 'awaiting_upload', {
        audio_sha256,
        audio_seconds
      });

      debug('Job created: %s for user %s', job.id, req.user.id);

      res.status(201).json({
        job: {
          id: job.id,
          status: 'awaiting_upload',
          audio_sha256,
          audio_seconds,
          language,
          additional_languages: additional_languages || [],
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
   * Upload audio data for a job. Stores to local temp file for processing.
   * Body: raw audio data (OGG Opus).
   */
  async _handleUploadAudio(req, res, next) {
    try {
      const jobId = req.params.id;
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

      if (!req.body || req.body.length === 0) {
        return res.status(400).json({ error: 'No audio data received' });
      }

      // Store to local temp file (transient — deleted after Whisper processes it)
      const fs = require('fs');
      const path = require('path');
      const tmpDir = path.join(__dirname, '..', 'tmp', 'audio');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpPath = path.join(tmpDir, `${jobId}.mp3`);
      fs.writeFileSync(tmpPath, req.body);

      debug('Audio saved for job %s: path=%s size=%d', jobId, tmpPath, req.body.length);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/jobs/:id/enqueue
   * Enqueue a job for processing (must own job).
   */
  async _handleEnqueueJob(req, res, next) {
    try {
      const jobId = req.params.id;
      const job = await this.handler.jobs.getById(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (job.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (job.status !== 'awaiting_upload') {
        return res.status(409).json({
          error: `Job cannot be enqueued from status '${job.status}'`
        });
      }

      // Update status to queued
      await this.handler.jobs.updateStatus(jobId, 'queued');

      // Enqueue via Worker
      await this.handler.worker.enqueue(jobId, {
        audio_sha256: job.audio_sha256,
        language: job.language
      });

      debug('Job %s enqueued by user %s', jobId, req.user.id);

      res.json({ id: jobId, status: 'queued' });
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

      const response = {
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
      };

      // Include subtitles if job succeeded
      if (job.status === 'succeeded') {
        const subtitleResult = await this.handler.postgres.query(
          'SELECT id, language, format, object_key, created_at FROM subtitles WHERE job_id = $1 ORDER BY language, format',
          [jobId]
        );
        response.subtitles = subtitleResult.rows;
      }

      res.json(response);
    } catch (error) {
      next(error);
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
