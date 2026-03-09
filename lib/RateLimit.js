// lib/RateLimit.js
const debug = require('debug')('SubtitleGenerator:RateLimit');
const rateLimit = require('express-rate-limit');

class RateLimit {
  constructor(handler) {
    this.handler = handler;
    this.maxConcurrentJobs = parseInt(process.env.MAX_CONCURRENT_JOBS, 10) || 3;
  }

  async init() {
    debug('RateLimit service initialized (maxConcurrentJobs=%d)', this.maxConcurrentJobs);
  }

  /**
   * Returns a general API rate-limiting middleware.
   * 100 requests per 15 minutes per IP address.
   * @returns {import('express').RequestHandler}
   */
  getMiddleware() {
    debug('Creating general rate limit middleware (100 req / 15 min)');

    return rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10000,
      standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
      legacyHeaders: false,  // Disable the `X-RateLimit-*` headers
      message: {
        error: 'Too many requests, please try again later.',
        retryAfter: '15 minutes'
      },
      keyGenerator: (req) => {
        // Use X-Forwarded-For if behind a proxy, otherwise req.ip
        return req.ip;
      }
    });
  }

  /**
   * Check whether a user has exceeded the maximum number of concurrent jobs.
   * Counts jobs in non-terminal states (awaiting_upload, queued, running).
   * @param {string} userId - UUID of the user
   * @returns {{ allowed: boolean, active: number, max: number }}
   */
  async checkConcurrentJobs(userId) {
    debug('Checking concurrent jobs for user %s', userId);

    const sql = `
      SELECT COUNT(*)::int AS active_count
      FROM jobs
      WHERE user_id = $1
        AND status IN ('awaiting_upload', 'queued', 'running')
    `;

    const result = await this.handler.postgres.query(sql, [userId]);
    const activeCount = result.rows[0].active_count;
    const allowed = activeCount < this.maxConcurrentJobs;

    debug(
      'User %s concurrent jobs: active=%d max=%d allowed=%s',
      userId, activeCount, this.maxConcurrentJobs, allowed
    );

    return {
      allowed,
      active: activeCount,
      max: this.maxConcurrentJobs
    };
  }

  /**
   * Returns a stricter rate-limiting middleware for job creation endpoints.
   * 10 requests per 1 minute per IP address.
   * @returns {import('express').RequestHandler}
   */
  getJobRateLimiter() {
    debug('Creating job creation rate limit middleware (10 req / 1 min)');

    return rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: 'Too many job creation requests, please try again later.',
        retryAfter: '1 minute'
      },
      keyGenerator: (req) => {
        return req.ip;
      }
    });
  }
}

module.exports = RateLimit;
