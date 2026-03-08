// lib/Postgres.js
const debug = require('debug')('SubtitleGenerator:Postgres');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const SLOW_QUERY_THRESHOLD_MS = 500;

class Postgres {
  constructor(handler) {
    this.handler = handler;
    this.pool = null;

    // Build connection config from env vars
    if (process.env.DATABASE_URL) {
      debug('Using DATABASE_URL for connection');
      this.connectionConfig = {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false }
      };
    } else {
      debug('Using individual PG_* env vars for connection');
      this.connectionConfig = {
        host: process.env.PG_HOST || 'localhost',
        port: parseInt(process.env.PG_PORT, 10) || 5432,
        user: process.env.PG_USER || 'postgres',
        password: process.env.PG_PASSWORD || '',
        database: process.env.PG_DATABASE || 'syncscribe'
      };

      if (process.env.PG_SSL !== 'false') {
        this.connectionConfig.ssl = { rejectUnauthorized: false };
      }
    }

    // Pool sizing
    this.connectionConfig.max = parseInt(process.env.PG_POOL_MAX, 10) || 20;
    this.connectionConfig.idleTimeoutMillis = parseInt(process.env.PG_IDLE_TIMEOUT, 10) || 30000;
    this.connectionConfig.connectionTimeoutMillis = parseInt(process.env.PG_CONNECT_TIMEOUT, 10) || 5000;
  }

  async init() {
    debug('Initializing Postgres connection pool');

    this.pool = new Pool(this.connectionConfig);

    // Log pool errors so they don't crash the process
    this.pool.on('error', (err) => {
      debug('Unexpected pool error on idle client: %O', err);
    });

    // Verify connectivity
    try {
      const result = await this.pool.query('SELECT 1 AS ok');
      if (result.rows[0].ok !== 1) {
        throw new Error('Connection verification failed: unexpected result');
      }
      debug('Postgres connection verified successfully');
    } catch (err) {
      debug('Failed to verify Postgres connection: %s', err.message);
      throw new Error(`Postgres connection failed: ${err.message}`);
    }
  }

  /**
   * Execute a parameterized query. Logs slow queries automatically.
   * @param {string} sql - SQL string with $1, $2, ... placeholders
   * @param {Array} params - Parameter values
   * @returns {import('pg').QueryResult}
   */
  async query(sql, params = []) {
    const start = Date.now();

    try {
      const result = await this.pool.query(sql, params);
      const duration = Date.now() - start;

      if (duration >= SLOW_QUERY_THRESHOLD_MS) {
        debug('SLOW QUERY (%dms): %s', duration, sql.substring(0, 200));
      }

      return result;
    } catch (err) {
      const duration = Date.now() - start;
      debug('Query failed after %dms: %s — %s', duration, sql.substring(0, 200), err.message);
      throw err;
    }
  }

  /**
   * Read and execute the bootstrap SQL file to create/update the schema.
   */
  async bootstrap() {
    debug('Running bootstrap SQL');

    const sqlPath = path.resolve(__dirname, '..', 'sql', 'bootstrap.sql');

    let sql;
    try {
      sql = fs.readFileSync(sqlPath, 'utf8');
    } catch (err) {
      throw new Error(`Failed to read bootstrap SQL at ${sqlPath}: ${err.message}`);
    }

    try {
      await this.pool.query(sql);
      debug('Bootstrap SQL executed successfully');
    } catch (err) {
      debug('Bootstrap SQL failed: %s', err.message);
      throw new Error(`Bootstrap SQL execution failed: ${err.message}`);
    }
  }

  /**
   * Acquire a dedicated client for use in transactions.
   * Caller MUST call client.release() when done.
   *
   * Usage:
   *   const client = await this.handler.postgres.getClient();
   *   try {
   *     await client.query('BEGIN');
   *     // ... queries ...
   *     await client.query('COMMIT');
   *   } catch (e) {
   *     await client.query('ROLLBACK');
   *     throw e;
   *   } finally {
   *     client.release();
   *   }
   *
   * @returns {import('pg').PoolClient}
   */
  async getClient() {
    const client = await this.pool.connect();
    debug('Client acquired from pool');
    return client;
  }

  /**
   * Gracefully shut down the pool.
   */
  async close() {
    if (this.pool) {
      debug('Closing Postgres connection pool');
      await this.pool.end();
      this.pool = null;
      debug('Postgres pool closed');
    }
  }
}

module.exports = Postgres;
