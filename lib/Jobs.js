// lib/Jobs.js
const debug = require('debug')('SubtitleGenerator:Jobs');
// High-frequency, low-value lines (e.g. per-poll "Fetching job") live on a
// :trace namespace so they can be silenced independently of the main logs.
const trace = require('debug')('SubtitleGenerator:Jobs:trace');
const fs = require('fs');
const path = require('path');

class Jobs {
  constructor(handler) {
    this.handler = handler;
  }

  /**
   * Broadcast a job lifecycle/stage change to all cluster workers so connected
   * SSE clients get a live push. Best-effort — failures degrade to the client
   * fallback poll and never block the job.
   * @param {string} jobId
   * @param {object} fields - e.g. { status } and/or { stage }
   */
  _publish(jobId, fields) {
    this.handler.postgres.notifyJobEvent({ jobId, ...fields });
  }

  async init() {
    // Expire stale jobs on startup
    await this.expireStaleJobs();

    // Run cleanup every 5 minutes
    this._cleanupInterval = setInterval(() => this.expireStaleJobs(), 5 * 60 * 1000);

    debug('Jobs service initialized (stale job cleanup every 5 min)');
  }

  /**
   * Fail jobs that can no longer finish, so they stop holding a credit
   * reservation and a concurrent-job slot:
   *  - awaiting_upload > 10 min: the client never uploaded / enqueued
   *  - queued > 1 hour: the enqueue was lost (e.g. process died mid-request)
   *  - running > 3 hours: the worker died mid-job (restart, deploy, reboot)
   * Credits are only debited when a job succeeds, so nothing needs refunding.
   */
  async expireStaleJobs() {
    try {
      const sql = `
        UPDATE jobs
        SET status = 'failed',
            error_code = 'EXPIRED',
            error_message = CASE status
              WHEN 'awaiting_upload' THEN 'Expired: upload never completed'
              WHEN 'queued' THEN 'Expired: job was never picked up'
              ELSE 'Expired: processing was interrupted'
            END,
            minutes_reserved = NULL,
            finished_at = NOW()
        WHERE (status = 'awaiting_upload' AND created_at < NOW() - INTERVAL '10 minutes')
           OR (status = 'queued' AND created_at < NOW() - INTERVAL '1 hour')
           OR (status = 'running' AND started_at < NOW() - INTERVAL '3 hours')
        RETURNING id
      `;
      const result = await this.handler.postgres.query(sql);
      if (result.rowCount > 0) {
        debug('Expired %d stale jobs: %s',
          result.rowCount, result.rows.map(r => r.id).join(', '));
        for (const row of result.rows) {
          this._publish(row.id, { status: 'failed' });
        }
      }
    } catch (err) {
      debug('Stale job cleanup failed: %s', err.message);
    }

    this._sweepTempAudio();
  }

  /**
   * Delete temp audio (uploads, partial uploads) older than the longest a job
   * can stay active. Normally the worker deletes a job's audio when it
   * finishes; this catches uploads whose job expired before being processed.
   */
  _sweepTempAudio() {
    const dir = path.join(__dirname, '..', 'tmp', 'audio');
    const cutoff = Date.now() - 4 * 60 * 60 * 1000;
    fs.readdir(dir, (err, names) => {
      if (err) return;
      for (const name of names) {
        const file = path.join(dir, name);
        fs.stat(file, (statErr, stat) => {
          if (!statErr && stat.mtimeMs < cutoff) {
            fs.rm(file, { force: true }, () => debug('Swept stale temp audio %s', name));
          }
        });
      }
    });
  }

  /**
   * Create a new job.
   * @param {string} userId - UUID of the user
   * @param {object} data - Job creation data
   * @param {string} [data.language] - Primary language code
   * @param {string[]} [data.additional_languages] - Additional language codes for translation
   * @param {string} [data.source_name] - Original media file name (name-correction hint)
   * @param {string} [data.media_title] - Container title tag (name-correction hint)
   * @param {string} [data.audio_sha256] - SHA-256 of the audio the client will upload
   * @param {number} [data.audio_seconds] - Client-estimated duration (re-measured on upload)
   * @param {number} [data.minutes_reserved] - Credits to hold while the job is active
   * @param {string} [data.mode] - Processing mode (default: 'transcribe')
   * @param {string} [data.model] - Model to use (default: 'whisper-1')
   * @param {import('pg').PoolClient} [client] - Run on this client (inside a transaction)
   * @returns {object} The created job row
   */
  async create(userId, data = {}, client = null) {
    debug('Creating job for user %s with data: %O', userId, data);

    const sql = `
      INSERT INTO jobs (user_id, language, additional_languages, source_name, media_title, mode, model,
                        audio_sha256, audio_seconds, minutes_reserved)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const params = [
      userId,
      data.language || null,
      data.additional_languages || null,
      data.source_name || null,
      data.media_title || null,
      data.mode || 'transcribe',
      data.model || 'whisper-1',
      data.audio_sha256 || null,
      data.audio_seconds || null,
      data.minutes_reserved || null
    ];

    const result = await (client || this.handler.postgres).query(sql, params);
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
    trace('Fetching job %s', jobId);

    const sql = 'SELECT * FROM jobs WHERE id = $1';
    const result = await this.handler.postgres.query(sql, [jobId]);

    if (result.rows.length === 0) {
      trace('Job %s not found', jobId);
      return null;
    }

    return result.rows[0];
  }

  /**
   * Set the fine-grained progress stage for a running job and broadcast it.
   * Stage is a free-form label such as 'transcribing', 'correcting',
   * 'translating:en', or 'finalizing'.
   * @param {string} jobId - UUID of the job
   * @param {string} stage - Stage label
   */
  async setStage(jobId, stage) {
    trace('Job %s stage -> %s', jobId, stage);
    await this.handler.postgres.query(
      'UPDATE jobs SET stage = $1 WHERE id = $2',
      [stage, jobId]
    );
    this._publish(jobId, { stage });
  }

  /**
   * Atomically move an uploaded job from awaiting_upload to queued.
   * @param {string} jobId - UUID of the job
   * @param {string} userId - Owner; the transition only applies to their job
   * @returns {object|null} The updated job, or null if it was not eligible
   */
  async markQueued(jobId, userId) {
    const result = await this.handler.postgres.query(
      `UPDATE jobs SET status = 'queued'
       WHERE id = $1 AND user_id = $2 AND status = 'awaiting_upload' AND audio_object_key IS NOT NULL
       RETURNING *`,
      [jobId, userId]
    );
    if (result.rows.length === 0) return null;
    this._publish(jobId, { status: 'queued' });
    return result.rows[0];
  }

  /**
   * Atomically claim a queued job for processing. A duplicate queue delivery
   * finds the job already running and gets null.
   * @param {string} jobId - UUID of the job
   * @returns {object|null} The running job row, or null if not claimable
   */
  async claim(jobId) {
    const result = await this.handler.postgres.query(
      `UPDATE jobs SET status = 'running', started_at = NOW()
       WHERE id = $1 AND status = 'queued'
       RETURNING *`,
      [jobId]
    );
    if (result.rows.length === 0) return null;
    this._publish(jobId, { status: 'running' });
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
        'minutes_charged', 'minutes_reserved', 'cached_hit', 'language',
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
    this._publish(job.id, { status: job.status });
    return job;
  }

  /**
   * Mark a job as succeeded.
   * @param {string} jobId - UUID of the job
   * @param {number} minutesCharged - Minutes that were charged for this job
   * @param {boolean} [cachedHit=false] - Whether the result came from cache
   * @param {import('pg').PoolClient} [client] - Run on this client (inside a transaction);
   *   the caller then calls publishStatus() after COMMIT
   * @returns {object|null} The updated job row, or null if the job is not running
   */
  async markSucceeded(jobId, minutesCharged, cachedHit = false, client = null) {
    debug('Marking job %s as succeeded (minutes=%d cached=%s)', jobId, minutesCharged, cachedHit);

    const sql = `
      UPDATE jobs
      SET status = 'succeeded',
          minutes_charged = $1,
          cached_hit = $2,
          minutes_reserved = NULL,
          finished_at = NOW()
      WHERE id = $3 AND status = 'running'
      RETURNING *
    `;

    const result = await (client || this.handler.postgres).query(sql, [minutesCharged, cachedHit, jobId]);

    if (result.rows.length === 0) {
      debug('Job %s not running; markSucceeded skipped', jobId);
      return null;
    }

    const job = result.rows[0];
    debug('Job %s succeeded at %s', job.id, job.finished_at);
    if (!client) this._publish(job.id, { status: 'succeeded' });
    return job;
  }

  /**
   * Broadcast a status change committed elsewhere (e.g. inside a transaction).
   * @param {string} jobId
   * @param {string} status
   */
  publishStatus(jobId, status) {
    this._publish(jobId, { status });
  }

  /**
   * Mark a job as failed.
   * @param {string} jobId - UUID of the job
   * @param {string} errorCode - Machine-readable error code
   * @param {string} errorMessage - Human-readable error description
   * Only applies to active jobs, so a late failure can't overwrite a success.
   * @returns {object|null} The updated job row, or null if the job is not active
   */
  async markFailed(jobId, errorCode, errorMessage) {
    debug('Marking job %s as failed: %s - %s', jobId, errorCode, errorMessage);

    const sql = `
      UPDATE jobs
      SET status = 'failed',
          error_code = $1,
          error_message = $2,
          minutes_reserved = NULL,
          finished_at = NOW()
      WHERE id = $3 AND status IN ('awaiting_upload', 'queued', 'running')
      RETURNING *
    `;

    const result = await this.handler.postgres.query(sql, [errorCode, errorMessage, jobId]);

    if (result.rows.length === 0) {
      debug('Job %s already finished or missing; markFailed skipped', jobId);
      return null;
    }

    const job = result.rows[0];
    debug('Job %s failed at %s', job.id, job.finished_at);
    this._publish(job.id, { status: 'failed', error_message: job.error_message });
    return job;
  }
}

module.exports = Jobs;
