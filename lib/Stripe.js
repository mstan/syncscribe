// lib/Stripe.js
const debug = require('debug')('SubtitleGenerator:Stripe');
const StripeSDK = require('stripe');

class Stripe {
  constructor(handler) {
    this.handler = handler;
    this.secretKey = process.env.STRIPE_SECRET_KEY;
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    this.stripe = null;
  }

  async init() {
    debug('Initializing Stripe service');

    if (!this.secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }

    if (!this.webhookSecret) {
      debug('WARNING: STRIPE_WEBHOOK_SECRET not set — webhook verification will fail');
    }

    this.stripe = new StripeSDK(this.secretKey, {
      apiVersion: '2025-06-30.basil'
    });

    debug('Stripe client initialized');
  }

  /**
   * Get all active credit packs from the database.
   * @returns {object[]} Array of credit pack rows
   */
  async getPacksWithPrices() {
    debug('Fetching credit packs with prices');

    const sql = `
      SELECT id, name, minutes_amount, price_cents, stripe_price_id, active
      FROM credit_packs
      WHERE active = TRUE
      ORDER BY price_cents ASC
    `;

    const result = await this.handler.postgres.query(sql);
    debug('Found %d active credit packs', result.rows.length);
    return result.rows;
  }

  /**
   * Create a Stripe Checkout Session for purchasing a credit pack.
   * @param {string} userId - UUID of the purchasing user
   * @param {string} packId - ID of the credit pack (e.g. 'starter')
   * @param {string} successUrl - URL to redirect to on success
   * @param {string} cancelUrl - URL to redirect to on cancel
   * @returns {string} The Checkout Session URL
   */
  async createCheckoutSession(userId, packId, successUrl, cancelUrl) {
    debug('Creating checkout session: userId=%s packId=%s', userId, packId);

    // Look up the credit pack
    const packSql = 'SELECT * FROM credit_packs WHERE id = $1 AND active = TRUE';
    const packResult = await this.handler.postgres.query(packSql, [packId]);

    if (packResult.rows.length === 0) {
      throw new Error(`Credit pack not found or inactive: ${packId}`);
    }

    const pack = packResult.rows[0];
    debug('Pack found: %s (%d minutes, $%d)', pack.name, pack.minutes_amount, pack.price_cents);

    // Build line items
    let lineItems;

    if (pack.stripe_price_id) {
      // Use existing Stripe Price
      lineItems = [{
        price: pack.stripe_price_id,
        quantity: 1
      }];
    } else {
      // Create ad-hoc price data
      lineItems = [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${pack.name} - ${pack.minutes_amount} minutes`,
            description: `SyncScribe ${pack.name} credit pack: ${pack.minutes_amount} minutes of audio processing`
          },
          unit_amount: pack.price_cents
        },
        quantity: 1
      }];
    }

    // Create the Checkout Session
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId,
        packId
      },
      client_reference_id: userId
    });

    debug('Checkout session created: sessionId=%s url=%s', session.id, session.url);
    return session;
  }

  /**
   * Handle a Stripe webhook event.
   * Verifies the signature, then processes supported event types.
   *
   * Currently handles:
   *  - checkout.session.completed: records purchase and credits the user
   *
   * @param {Buffer|string} rawBody - Raw request body
   * @param {string} signature - Stripe-Signature header value
   * @returns {{ handled: boolean, event?: string }}
   */
  async handleWebhook(rawBody, signature) {
    debug('Processing webhook');

    // Verify the webhook signature
    let event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (err) {
      debug('Webhook signature verification failed: %s', err.message);
      throw new Error(`Webhook signature verification failed: ${err.message}`);
    }

    debug('Webhook event received: type=%s id=%s', event.type, event.id);

    if (event.type === 'checkout.session.completed') {
      return await this._handleCheckoutCompleted(event.data.object);
    }

    debug('Unhandled webhook event type: %s', event.type);
    return { handled: false };
  }

  /**
   * Process a completed checkout session.
   * 1. Extract metadata (userId, packId)
   * 2. Look up the pack for minutes_amount
   * 3. Insert purchase record (idempotent via provider_checkout_session_id UNIQUE)
   * 4. Insert credit ledger entry
   * @param {object} session - Stripe Checkout Session object
   * @returns {{ handled: boolean, event: string }}
   * @private
   */
  async _handleCheckoutCompleted(session) {
    const { userId, packId } = session.metadata || {};

    debug('Checkout completed: sessionId=%s userId=%s packId=%s', session.id, userId, packId);

    if (!userId || !packId) {
      debug('Missing metadata in checkout session, skipping');
      return { handled: false };
    }

    // Look up the pack
    const packSql = 'SELECT * FROM credit_packs WHERE id = $1';
    const packResult = await this.handler.postgres.query(packSql, [packId]);

    if (packResult.rows.length === 0) {
      debug('Pack not found for checkout: packId=%s', packId);
      throw new Error(`Credit pack not found: ${packId}`);
    }

    const pack = packResult.rows[0];

    // Use a transaction for atomicity
    const client = await this.handler.postgres.getClient();

    try {
      await client.query('BEGIN');

      // Insert purchase record (idempotent via UNIQUE on provider_checkout_session_id)
      const purchaseSql = `
        INSERT INTO purchases (user_id, provider, provider_checkout_session_id, provider_payment_intent_id, pack_id, price_cents, currency, status)
        VALUES ($1, 'stripe', $2, $3, $4, $5, $6, 'completed')
        ON CONFLICT (provider_checkout_session_id) DO NOTHING
        RETURNING *
      `;

      const purchaseResult = await client.query(purchaseSql, [
        userId,
        session.id,
        session.payment_intent || null,
        packId,
        session.amount_total || pack.price_cents,
        session.currency || 'usd'
      ]);

      if (purchaseResult.rows.length === 0) {
        // Purchase already processed (idempotent)
        debug('Purchase already recorded for session %s (idempotent)', session.id);
        await client.query('COMMIT');
        return { handled: true, event: 'checkout.session.completed' };
      }

      const purchase = purchaseResult.rows[0];
      debug('Purchase recorded: id=%s', purchase.id);

      // Insert credit ledger entry
      const ledgerSql = `
        INSERT INTO credit_ledger (user_id, type, minutes_delta, purchase_id, note)
        VALUES ($1, 'purchase', $2, $3, $4)
      `;

      await client.query(ledgerSql, [
        userId,
        pack.minutes_amount,
        purchase.id,
        `Credit pack purchase: ${pack.name} (${pack.minutes_amount} minutes)`
      ]);

      debug('Credit ledger entry created: +%d minutes for user %s', pack.minutes_amount, userId);

      await client.query('COMMIT');

      debug('Checkout session %s fully processed', session.id);
      return { handled: true, event: 'checkout.session.completed' };
    } catch (err) {
      await client.query('ROLLBACK');
      debug('Checkout processing failed, rolled back: %s', err.message);
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = Stripe;
