// lib/Credits.js
const debug = require('debug')('SubtitleGenerator:Credits');

class Credits {
  constructor(handler) {
    this.handler = handler;
  }

  async init() {
    debug('Credits service initialized');
  }

  /**
   * Get the current credit balance (in minutes) for a user.
   * Computes from the ledger by summing all minutes_delta entries.
   * @param {string} userId - UUID of the user
   * @returns {number} Balance in minutes (can be negative if something went wrong)
   */
  async getBalance(userId) {
    debug('Getting credit balance for user %s', userId);

    const sql = `
      SELECT COALESCE(SUM(minutes_delta), 0)::int AS balance
      FROM credit_ledger
      WHERE user_id = $1
    `;

    const result = await this.handler.postgres.query(sql, [userId]);
    const balance = result.rows[0].balance;

    debug('User %s balance: %d minutes', userId, balance);
    return balance;
  }

  /**
   * Credit minutes to a user's account from a purchase.
   * @param {string} userId - UUID of the user
   * @param {string} purchaseId - UUID of the purchase record
   * @param {number} minutes - Number of minutes to credit (positive)
   * @returns {object} The created ledger entry
   */
  async creditPurchase(userId, purchaseId, minutes) {
    debug('Crediting purchase: user=%s purchase=%s minutes=%d', userId, purchaseId, minutes);

    if (minutes <= 0) {
      throw new Error('Credit amount must be positive');
    }

    const sql = `
      INSERT INTO credit_ledger (user_id, type, minutes_delta, purchase_id, note)
      VALUES ($1, 'purchase', $2, $3, 'Credit pack purchase')
      RETURNING *
    `;

    const result = await this.handler.postgres.query(sql, [userId, minutes, purchaseId]);
    const entry = result.rows[0];

    debug('Purchase credit recorded: ledger_id=%s', entry.id);
    return entry;
  }

  /**
   * Debit minutes from a user's account for a job.
   * The unique index on (job_id) WHERE type='job_debit' ensures idempotency —
   * calling this twice with the same jobId will fail with a unique constraint violation.
   * @param {string} userId - UUID of the user
   * @param {string} jobId - UUID of the job
   * @param {number} minutes - Number of minutes to debit (positive value; stored as negative)
   * @returns {object} The created ledger entry
   */
  async debitJob(userId, jobId, minutes) {
    debug('Debiting job: user=%s job=%s minutes=%d', userId, jobId, minutes);

    if (minutes <= 0) {
      throw new Error('Debit amount must be positive');
    }

    const sql = `
      INSERT INTO credit_ledger (user_id, type, minutes_delta, job_id, note)
      VALUES ($1, 'job_debit', $2, $3, 'Job processing charge')
      RETURNING *
    `;

    try {
      const result = await this.handler.postgres.query(sql, [userId, -minutes, jobId]);
      const entry = result.rows[0];
      debug('Job debit recorded: ledger_id=%s', entry.id);
      return entry;
    } catch (err) {
      // Unique constraint violation means this job was already debited (idempotent)
      if (err.code === '23505' && err.constraint === 'idx_credit_ledger_job_debit') {
        debug('Job %s already debited (idempotent no-op)', jobId);
        return null;
      }
      throw err;
    }
  }

  /**
   * Refund minutes for a job.
   * @param {string} userId - UUID of the user
   * @param {string} jobId - UUID of the job being refunded
   * @param {number} minutes - Number of minutes to refund (positive value)
   * @param {string} [note] - Optional note explaining the refund
   * @returns {object} The created ledger entry
   */
  async refund(userId, jobId, minutes, note) {
    debug('Refunding job: user=%s job=%s minutes=%d', userId, jobId, minutes);

    if (minutes <= 0) {
      throw new Error('Refund amount must be positive');
    }

    const sql = `
      INSERT INTO credit_ledger (user_id, type, minutes_delta, job_id, note)
      VALUES ($1, 'refund', $2, $3, $4)
      RETURNING *
    `;

    const result = await this.handler.postgres.query(sql, [
      userId,
      minutes,
      jobId,
      note || 'Job refund'
    ]);
    const entry = result.rows[0];

    debug('Refund recorded: ledger_id=%s', entry.id);
    return entry;
  }

  /**
   * Credit minutes to a user's account from a promo code.
   * @param {string} userId - UUID of the user
   * @param {string} code - The promo code redeemed
   * @param {number} minutes - Number of minutes to credit (positive)
   * @returns {object} The created ledger entry
   */
  async creditPromo(userId, code, minutes) {
    debug('Crediting promo: user=%s code=%s minutes=%d', userId, code, minutes);

    if (minutes <= 0) {
      throw new Error('Credit amount must be positive');
    }

    const sql = `
      INSERT INTO credit_ledger (user_id, type, minutes_delta, note)
      VALUES ($1, 'promo', $2, $3)
      RETURNING *
    `;

    const result = await this.handler.postgres.query(sql, [userId, minutes, `Promo code: ${code}`]);
    const entry = result.rows[0];

    debug('Promo credit recorded: ledger_id=%s', entry.id);
    return entry;
  }

  /**
   * Check if a user has enough credits for an operation.
   * @param {string} userId - UUID of the user
   * @param {number} minutesNeeded - Minutes required
   * @returns {boolean} True if user has enough credits
   */
  async hasEnoughCredits(userId, minutesNeeded) {
    const balance = await this.getBalance(userId);
    const enough = balance >= minutesNeeded;
    debug('User %s credits check: balance=%d needed=%d enough=%s', userId, balance, minutesNeeded, enough);
    return enough;
  }

  /**
   * Calculate the total minute cost for a job.
   *
   * Base cost = ceil(audioSeconds / 60)
   * Translation cost per additional language = ceil(baseMinutes * 0.5)
   * Total = baseMinutes + (additionalLanguageCount * translationMinutesPerLang)
   *
   * @param {number} audioSeconds - Duration of the audio in seconds
   * @param {number} [additionalLanguageCount=0] - Number of additional languages to translate to
   * @returns {number} Total minutes to charge
   */
  calculateJobCost(audioSeconds, additionalLanguageCount = 0) {
    const baseMinutes = Math.ceil(audioSeconds / 60);
    const translationMinutes = additionalLanguageCount * Math.ceil(baseMinutes * 0.5);
    const total = baseMinutes + translationMinutes;

    debug(
      'Job cost calculation: audioSeconds=%d baseMinutes=%d additionalLangs=%d translationMinutes=%d total=%d',
      audioSeconds, baseMinutes, additionalLanguageCount, translationMinutes, total
    );

    return total;
  }
}

module.exports = Credits;
