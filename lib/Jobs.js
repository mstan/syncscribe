// lib/Jobs.js
const debug = require('debug')('SubtitleGenerator:Jobs');

class Jobs {
  constructor(handler) {
    this.handler = handler;
  }

  async init() {
    // Expire stale jobs on startup
    await this.expireStaleJobs();

    // Run cleanup every 5 minutes
    this._cleanupInterval = setInterval(() => this.expireStaleJobs(), 5 * 60 * 1000);

    debug('Jobs service initialized (stale job cleanup every 5 min)');
  }

  /**
   * Expire jobs stuck in awaiting_upload for more than 10 minutes.
   * These are orphans from failed uploads or client disconnects.
   */
  async expireStaleJobs() {
    try {
      const sql = `
        UPDATE jobs
        SET status = 'failed',
            error_message = 'Expired: upload never completed',
            finished_at = NOW()
        WHERE status = 'awaiting_upload'
          AND created_at < NOW() - INTERVAL '10 minutes'
        RETURNING id
      `;
      const result = await this.handler.postgres.query(sql);
      if (result.rowCount > 0) {
        debug('Expired %d stale awaiting_upload jobs: %s',
          result.rowCount, result.rows.map(r => r.id).join(', '));
      }
    } catch (err) {
      debug('Stale job cleanup failed: %s', err.message);
    }
  }

  /**
   * Create a new job.
   * @param {string} userId - UUID of the user
   * @param {object} data - Job creation data
   * @param {string} [data.language] - Primary language code
   * @param {string[]} [data.additional_languages] - Additional language codes for translation
   * @param {string} [data.mode] - Processing mode (default: 'transcribe')
   * @param {string} [data.model] - Model to use (default: 'whisper-1')
   * @returns {object} The created job row
   */
  async create(userId, data = {}) {
    debug('Creating job for user %s with data: %O', userId, data);

    const sql = `
      INSERT INTO jobs (user_id, language, additional_languages, series_context, mode, model)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const params = [
      userId,
      data.language || null,
      data.additional_languages || null,
      data.series_context || null,
      data.mode || 'transcribe',
      data.model || 'whisper-1'
    ];

    const result = await this.handler.postgres.query(sql, params);
    const job = result.rows[0];

    debug('Job created: id=%s status=%s', job.id, job.status);
    return job;
  }

  /**
   * Get a job by its ID.
   * @param {string} jobId - UUID of the job
   * @returns {object|null} The job row or null if not found
   */
  async getById(jobId) {
    debug('Fetching job %s', jobId);

    const sql = 'SELECT * FROM jobs WHERE id = $1';
    const result = await this.handler.postgres.query(sql, [jobId]);

    if (result.rows.length === 0) {
      debug('Job %s not found', jobId);
      return null;
    }

    return result.rows[0];
  }

  /**
   * Get recent jobs for a user, ordered by creation date descending.
   * @param {string} userId - UUID of the user
   * @param {number} [limit=20] - Maximum number of jobs to return
   * @returns {object[]} Array of job rows
   */
  async getByUser(userId, limit = 20) {
    debug('Fetching jobs for user %s (limit=%d)', userId, limit);

    const sql = `
      SELECT * FROM jobs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    const result = await this.handler.postgres.query(sql, [userId, limit]);
    debug('Found %d jobs for user %s', result.rows.length, userId);
    return result.rows;
  }

  /**
   * Update the status of a job with optional extra fields.
   * Automatically sets started_at when transitioning to 'running'
   * and finished_at when transitioning to a terminal state.
   * @param {string} jobId - UUID of the job
   * @param {string} status - New status value
   * @param {object} [extras={}] - Additional columns to update
   * @returns {object|null} The updated job row or null if not found
   */
  async updateStatus(jobId, status, extras = {}) {
    debug('Updating job %s status to %s with extras: %O', jobId, status, extras);

    // Build dynamic SET clauses for the extras
    const setClauses = ['status = $1'];
    const params = [status];
    let paramIndex = 2;

    // Auto-set timestamp columns based on status transition
    if (status === 'running') {
      setClauses.push(`started_at = NOW()`);
    }

    if (status === 'succeeded' || status === 'failed' || status === 'cancelled') {
      setClauses.push(`finished_at = NOW()`);
    }

    // Add any extra fields
    for (const [key, value] of Object.entries(extras)) {
      // Whitelist of allowed columns to prevent injection
      const allowedColumns = [
        'audio_sha256', 'audio_object_key', 'audio_seconds',
        'minutes_charged', 'cached_hit', 'language',
        'additional_languages', 'mode', 'model',
        'error_code', 'error_message'
      ];

      if (!allowedColumns.includes(key)) {
        debug('Skipping disallowed column: %s', key);
        continue;
      }

      setClauses.push(`${key} = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }

    params.push(jobId);

    const sql = `
      UPDATE jobs
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.handler.postgres.query(sql, params);

    if (result.rows.length === 0) {
      debug('Job %s not found for status update', jobId);
      return null;
    }

    const job = result.rows[0];
    debug('Job %s updated: status=%s', job.id, job.status);
    return job;
  }

  /**
   * Mark a job as succeeded.
   * @param {string} jobId - UUID of the job
   * @param {number} minutesCharged - Minutes that were charged for this job
   * @param {boolean} [cachedHit=false] - Whether the result came from cache
   * @returns {object|null} The updated job row or null if not found
   */
  async markSucceeded(jobId, minutesCharged, cachedHit = false) {
    debug('Marking job %s as succeeded (minutes=%d cached=%s)', jobId, minutesCharged, cachedHit);

    const sql = `
      UPDATE jobs
      SET status = 'succeeded',
          minutes_charged = $1,
          cached_hit = $2,
          finished_at = NOW()
      WHERE id = $3
      RETURNING *
    `;

    const result = await this.handler.postgres.query(sql, [minutesCharged, cachedHit, jobId]);

    if (result.rows.length === 0) {
      debug('Job %s not found for markSucceeded', jobId);
      return null;
    }

    const job = result.rows[0];
    debug('Job %s succeeded at %s', job.id, job.finished_at);
    return job;
  }

  /**
   * Mark a job as failed.
   * @param {string} jobId - UUID of the job
   * @param {string} errorCode - Machine-readable error code
   * @param {string} errorMessage - Human-readable error description
   * @returns {object|null} The updated job row or null if not found
   */
  async markFailed(jobId, errorCode, errorMessage) {
    debug('Marking job %s as failed: %s - %s', jobId, errorCode, errorMessage);

    const sql = `
      UPDATE jobs
      SET status = 'failed',
          error_code = $1,
          error_message = $2,
          finished_at = NOW()
      WHERE id = $3
      RETURNING *
    `;

    const result = await this.handler.postgres.query(sql, [errorCode, errorMessage, jobId]);

    if (result.rows.length === 0) {
      debug('Job %s not found for markFailed', jobId);
      return null;
    }

    const job = result.rows[0];
    debug('Job %s failed at %s', job.id, job.finished_at);
    return job;
  }
}

module.exports = Jobs;
