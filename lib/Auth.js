// lib/Auth.js
const debug = require('debug')('SubtitleGenerator:Auth');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

class Auth {
  constructor(handler) {
    this.handler = handler;
    this.googleClient = null;
    this.googleClientId = process.env.GOOGLE_CLIENT_ID;
    this.jwtSecret = process.env.JWT_SECRET;
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';
  }

  async init() {
    debug('Initializing Auth service');

    if (!this.googleClientId) {
      debug('WARNING: GOOGLE_CLIENT_ID not set — Google token verification will fail');
    }

    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    this.googleClient = new OAuth2Client(this.googleClientId);

    debug('Auth service initialized (googleClientId=%s)', this.googleClientId ? '***' + this.googleClientId.slice(-6) : 'NOT SET');
  }

  /**
   * Verify a Google ID token and extract the payload.
   * @param {string} idToken - The Google ID token from the client
   * @returns {{ sub: string, email: string, name: string, picture: string }}
   */
  async verifyGoogleToken(idToken) {
    debug('Verifying Google ID token');

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.googleClientId
      });

      const payload = ticket.getPayload();

      debug('Google token verified: email=%s sub=%s', payload.email, payload.sub);

      return {
        sub: payload.sub,
        email: payload.email,
        name: payload.name || null,
        picture: payload.picture || null
      };
    } catch (err) {
      debug('Google token verification failed: %s', err.message);
      throw new Error(`Invalid Google ID token: ${err.message}`);
    }
  }

  /**
   * Find an existing user by google_id or create a new one.
   * @param {{ sub: string, email: string, name: string, picture: string }} googlePayload
   * @returns {object} The user row
   */
  async findOrCreateUser(googlePayload) {
    const { sub: googleId, email, name, picture } = googlePayload;
    debug('findOrCreateUser: googleId=%s email=%s', googleId, email);

    // Try to find existing user by google_id
    const findSql = 'SELECT * FROM users WHERE google_id = $1';
    const findResult = await this.handler.postgres.query(findSql, [googleId]);

    if (findResult.rows.length > 0) {
      const user = findResult.rows[0];
      debug('Found existing user: id=%s email=%s', user.id, user.email);

      // Update profile info if changed
      if (user.name !== name || user.picture !== picture || user.email !== email) {
        debug('Updating user profile info');
        const updateSql = `
          UPDATE users SET name = $1, picture = $2, email = $3
          WHERE id = $4
          RETURNING *
        `;
        const updateResult = await this.handler.postgres.query(updateSql, [name, picture, email, user.id]);
        return updateResult.rows[0];
      }

      return user;
    }

    // Create new user
    debug('Creating new user for googleId=%s email=%s', googleId, email);
    const insertSql = `
      INSERT INTO users (google_id, email, name, picture)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    try {
      const insertResult = await this.handler.postgres.query(insertSql, [googleId, email, name, picture]);
      const newUser = insertResult.rows[0];
      debug('New user created: id=%s', newUser.id);

      // Grant 10 free signup minutes
      try {
        await this.handler.credits.creditPromo(newUser.id, 'SIGNUP', 10);
        debug('Granted 10 free signup minutes to user %s', newUser.id);
      } catch (grantErr) {
        debug('Failed to grant signup credits (non-fatal): %s', grantErr.message);
      }

      return newUser;
    } catch (err) {
      // Handle race condition where user was created between SELECT and INSERT
      if (err.code === '23505') {
        debug('Race condition on user creation, retrying lookup');
        const retryResult = await this.handler.postgres.query(findSql, [googleId]);
        if (retryResult.rows.length > 0) {
          return retryResult.rows[0];
        }
      }
      throw err;
    }
  }

  /**
   * Generate a signed JWT for a user.
   * @param {{ id: string, email: string }} user - The user object
   * @returns {string} Signed JWT string
   */
  generateJWT(user) {
    debug('Generating JWT for user %s', user.id);

    const payload = {
      id: user.id,
      email: user.email
    };

    const token = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn,
      issuer: 'syncscribe'
    });

    debug('JWT generated for user %s (expires in %s)', user.id, this.jwtExpiresIn);
    return token;
  }

  /**
   * Verify and decode a JWT.
   * @param {string} token - The JWT string
   * @returns {{ id: string, email: string }} Decoded payload
   */
  verifyJWT(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        issuer: 'syncscribe'
      });
      debug('JWT verified for user %s', decoded.id);
      return decoded;
    } catch (err) {
      debug('JWT verification failed: %s', err.message);
      throw new Error(`Invalid token: ${err.message}`);
    }
  }

  /**
   * Express middleware that extracts and verifies JWT from
   * the Authorization header (Bearer token) or the 'token' cookie.
   * On success, attaches req.user = { id, email }.
   * On failure, responds with 401.
   * @returns {import('express').RequestHandler}
   */
  authMiddleware() {
    return (req, res, next) => {
      let token = null;

      // Try Authorization header first
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }

      // Fall back to cookie
      if (!token && req.cookies && req.cookies.token) {
        token = req.cookies.token;
      }

      if (!token) {
        debug('No auth token found in request');
        return res.status(401).json({ error: 'Authentication required' });
      }

      try {
        const decoded = this.verifyJWT(token);
        req.user = { id: decoded.id, email: decoded.email };
        debug('Request authenticated: user=%s', decoded.id);
        next();
      } catch (err) {
        debug('Auth middleware token verification failed: %s', err.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    };
  }
}

module.exports = Auth;
