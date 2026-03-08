const API_BASE = '';

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
   * Generic request helper. Throws on non-ok responses with the parsed error body.
   */
  async _request(method, path, body = undefined) {
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
      const err = new Error(error.message || `Request failed: ${res.status}`);
      err.status = res.status;
      err.body = error;
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
   * @param {ArrayBuffer} audioBuffer - the raw audio data
   * @param {function} onProgress - optional progress callback (0-100)
   */
  async uploadAudio(jobId, audioBuffer, onProgress = null) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/jobs/${jobId}/upload`, true);
      xhr.setRequestHeader('Content-Type', 'audio/flac');

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
        } else {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
        }
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
   * Get a download URL for subtitles.
   * @param {string} jobId
   * @param {string} language - language code (e.g. 'en')
   * @param {string} format - 'srt' or 'vtt'
   */
  async getSubtitleUrl(jobId, language, format) {
    return this._request('GET', `/api/jobs/${jobId}/subtitles/${language}/${format}`);
  }
}

const api = new Api();
export default api;
