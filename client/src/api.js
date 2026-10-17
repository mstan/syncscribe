const API_BASE = '';

/**
 * Dispatched on window when an authenticated request gets a 401, with
 * detail = { token } (the token that was rejected). useAuth listens and signs
 * the user out, so an expired session surfaces everywhere instead of each
 * caller swallowing it.
 */
export const AUTH_EXPIRED_EVENT = 'syncscribe:auth-expired';

/**
 * Pull a human-readable message out of an API error body. The server sends
 * { error: "..." }; fall back to { message } and then the status.
 */
function errorMessage(body, status) {
  return body?.error || body?.message || `Request failed: ${status}`;
}

class Api {
  /**
   * Get the stored auth token from localStorage.
   */
  _getToken() {
    return localStorage.getItem('syncscribe_token');
  }

  /**
   * Build headers for authenticated requests.
   */
  _headers(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    const token = this._getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Broadcast an expired/invalid session if this 401 was for a request that
   * actually carried a token (a 401 on an anonymous request isn't a sign-out).
   */
  _checkUnauthorized(status, token) {
    if (status === 401 && token && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { token } }));
    }
  }

  /**
   * Generic request helper. Throws on non-ok responses with the parsed error body.
   */
  async _request(method, path, body = undefined) {
    const token = this._getToken();
    const options = {
      method,
      headers: this._headers()
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(`${API_BASE}${path}`, options);

    if (!res.ok) {
      let error;
      try {
        error = await res.json();
      } catch {
        error = { message: res.statusText };
      }
      const err = new Error(errorMessage(error, res.status));
      err.status = res.status;
      err.body = error;
      // A 401 from /auth/* means the Google credential was rejected, not that the session expired.
      this._checkUnauthorized(res.status, path.startsWith('/auth/') ? null : token);
      throw err;
    }

    // Handle 204 No Content
    if (res.status === 204) {
      return null;
    }

    return res.json();
  }

  // ── Auth ────────────────────────────────────────────────────────────

  /**
   * Exchange a Google OAuth credential for a session token.
   * Returns { token, user }.
   */
  async googleLogin(credential) {
    return this._request('POST', '/auth/google', { credential });
  }

  /**
   * Get the current authenticated user profile.
   * Returns user object.
   */
  async getMe() {
    return this._request('GET', '/api/me');
  }

  // ── Credits ─────────────────────────────────────────────────────────

  /**
   * Get the current user's credit balance.
   * Returns { balance } in minutes.
   */
  async getCredits() {
    return this._request('GET', '/api/credits');
  }

  /**
   * Get available credit packs for purchase.
   * Returns array of pack objects.
   */
  async getCreditPacks() {
    return this._request('GET', '/api/credit-packs');
  }

  /**
   * Create a Stripe checkout session for a credit pack.
   * Returns { url } - the Stripe Checkout URL.
   */
  async getCheckoutUrl(packId) {
    return this._request('POST', '/api/checkout', { pack_id: packId });
  }

  /**
   * Redeem a promo code for free credits.
   * Returns { minutes_granted, balance }.
   */
  async redeemPromo(code) {
    return this._request('POST', '/api/redeem-promo', { code });
  }

  // ── Jobs ────────────────────────────────────────────────────────────

  /**
   * Create a new transcription job.
   * @param {Object} data - { audio_sha256, audio_seconds, language, additional_languages }
   * Returns { job, upload_url }.
   */
  async createJob(data) {
    return this._request('POST', '/api/jobs', data);
  }

  /**
   * Upload extracted audio to the server.
   * @param {string} jobId - Job ID to upload audio for
   * @param {ArrayBuffer} audioBuffer - the raw audio data (exactly the bytes hashed into audio_sha256)
   * @param {function} onProgress - optional progress callback (0-100)
   */
  async uploadAudio(jobId, audioBuffer, onProgress = null) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/jobs/${jobId}/upload`, true);
      // UploadDropzone extracts MP3 (libmp3lame, 48 kbps mono 16 kHz).
      xhr.setRequestHeader('Content-Type', 'audio/mpeg');

      const token = this._getToken();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
      }

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }

        let body = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          // Non-JSON body (e.g. a proxy's HTML 413 page)
        }
        const message = xhr.status === 413
          ? (body?.error || 'The extracted audio is too large to upload.')
          : body?.error || body?.message || `Upload failed: ${xhr.status} ${xhr.statusText}`;
        const err = new Error(message);
        err.status = xhr.status;
        err.body = body;
        this._checkUnauthorized(xhr.status, token);
        reject(err);
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed: network error'));
      });

      xhr.send(audioBuffer);
    });
  }

  /**
   * Enqueue a job for processing after audio upload is complete.
   */
  async enqueueJob(jobId) {
    return this._request('POST', `/api/jobs/${jobId}/enqueue`);
  }

  /**
   * Get the current status of a job.
   */
  async getJob(jobId) {
    return this._request('GET', `/api/jobs/${jobId}`);
  }

  /**
   * Build the URL for the job-events SSE stream. EventSource can't set an
   * Authorization header, so a short-lived token scoped to this one job's
   * stream is passed as a query param (never the session JWT, which would end
   * up in access logs).
   * @returns {Promise<string>}
   */
  async jobEventsUrl(jobId) {
    const { token } = await this._request('POST', `/api/jobs/${jobId}/events-token`);
    return `${API_BASE}/api/jobs/${jobId}/events?access_token=${encodeURIComponent(token)}`;
  }

  /**
   * Get a download URL for subtitles.
   * @param {string} jobId
   * @param {string} language - language code (e.g. 'en')
   * @param {string} format - 'srt' or 'vtt'
   */
  async getSubtitleUrl(jobId, language, format) {
    return this._request('GET', `/api/jobs/${jobId}/subtitles/${language}/${format}`);
  }

  /**
   * Get subtitle file content as text (proxied through our server, no CORS issues).
   * @param {string} jobId
   * @param {string} language - language code (e.g. 'en')
   * @param {string} format - 'srt' or 'vtt'
   * @returns {Promise<string>} Subtitle text content
   */
  async getSubtitleContent(jobId, language, format) {
    const token = this._getToken();
    const res = await fetch(`${API_BASE}/api/jobs/${jobId}/subtitles/${language}/${format}/content`, {
      headers: this._headers()
    });
    if (!res.ok) {
      const err = new Error(`Failed to fetch subtitle content: ${res.status}`);
      err.status = res.status;
      this._checkUnauthorized(res.status, token);
      throw err;
    }
    return res.text();
  }
  // ── Shared (public, no auth) ─────────────────────────────────────

  async getSharedJob(jobId) {
    return this._request('GET', `/api/shared/jobs/${jobId}`);
  }

  async getSharedSubtitleUrl(jobId, language, format) {
    return this._request('GET', `/api/shared/jobs/${jobId}/subtitles/${language}/${format}`);
  }

  async getSharedSubtitleContent(jobId, language, format) {
    const res = await fetch(`${API_BASE}/api/shared/jobs/${jobId}/subtitles/${language}/${format}/content`);
    if (!res.ok) {
      const err = new Error(`Failed to fetch subtitle content: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.text();
  }
}

const api = new Api();
export default api;
