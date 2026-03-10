// lib/SubtitleApp.js
const debug = require('debug')('SubtitleGenerator:SubtitleApp');
const path = require('path');
const fs = require('fs-extra');

const Postgres = require('./Postgres');
const Credits = require('./Credits');
const Jobs = require('./Jobs');
const MediaCache = require('./MediaCache');
const RateLimit = require('./RateLimit');
const Auth = require('./Auth');
const R2 = require('./R2');
const Stripe = require('./Stripe');
const Transcriber = require('./Transcriber');
const SubtitleWriter = require('./SubtitleWriter');
const Translator = require('./Translator');
const Corrector = require('./Corrector');
const Worker = require('./Worker');
const ExpressApi = require('./ExpressApi');

class SubtitleApp {
  constructor(options = {}) {
    this.appRootPath = options.appRootPath || process.cwd();
    this.config = options.config || {};
    this.tmpFileDir = path.join(this.appRootPath, 'tmp');
    this.outputFileDir = path.join(this.appRootPath, 'output');

    // Service instances (initialized in init())
    this.postgres = null;
    this.credits = null;
    this.jobs = null;
    this.mediaCache = null;
    this.rateLimit = null;
    this.auth = null;
    this.r2 = null;
    this.stripe = null;
    this.worker = null;
    this.api = null;
    this.transcriber = null;
    this.subtitleWriter = null;
    this.translator = null;
    this.corrector = null;
  }

  async init() {
    debug('Initializing SubtitleApp');

    // Ensure directories
    await fs.mkdirp(this.tmpFileDir);
    await fs.mkdirp(this.outputFileDir);

    // 1. Database
    this.postgres = new Postgres(this);
    await this.postgres.init();
    await this.postgres.bootstrap();

    // 2. Core services
    this.credits = new Credits(this);
    await this.credits.init();

    this.jobs = new Jobs(this);
    await this.jobs.init();

    this.mediaCache = new MediaCache(this);
    await this.mediaCache.init();

    this.rateLimit = new RateLimit(this);
    await this.rateLimit.init();

    this.auth = new Auth(this);
    await this.auth.init();

    // 3. External services
    this.r2 = new R2(this);
    await this.r2.init();

    this.stripe = new Stripe(this);
    await this.stripe.init();

    // 4. Transcription services (reuse existing classes)
    this.transcriber = new Transcriber(this);
    await this.transcriber.init();

    this.subtitleWriter = new SubtitleWriter(this);
    await this.subtitleWriter.init();

    this.translator = new Translator(this);
    await this.translator.init();

    this.corrector = new Corrector(this);
    await this.corrector.init();

    // 5. Worker (pg-boss)
    this.worker = new Worker(this);
    await this.worker.init();

    // 6. Express API (start last)
    this.api = new ExpressApi(this);
    await this.api.init();

    debug('SubtitleApp initialized successfully');
  }

  /**
   * Gracefully shut down all services in reverse order.
   */
  async shutdown() {
    debug('Shutting down SubtitleApp...');

    if (this.worker) {
      await this.worker.stop();
    }

    if (this.api) {
      await this.api.stop();
    }

    if (this.postgres) {
      await this.postgres.close();
    }

    debug('SubtitleApp shut down');
  }
}

module.exports = SubtitleApp;
