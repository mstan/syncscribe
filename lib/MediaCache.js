// lib/MediaCache.js
const debug = require('debug')('SubtitleGenerator:MediaCache');

class MediaCache {
  constructor(handler) {
    this.handler = handler;
  }

  async init() {
    debug('MediaCache service initialized');
  }

  /**
   * Look up a cached result by audio hash, language, and mode.
   * On a cache hit, atomically increments hit_count and updates last_accessed_at.
   * @param {string} audioSha256 - SHA-256 hash of the audio file
   * @param {string} language - Language code (e.g. 'en')
   * @param {string} [mode='transcribe'] - Processing mode
   * @returns {object|null} Cache entry or null if not found
   */
  async lookup(audioSha256, language, mode = 'transcribe') {
    debug('Cache lookup: sha256=%s language=%s mode=%s', audioSha256, language, mode);

    const sql = `
      UPDATE media_cache
      SET hit_count = hit_count + 1,
          last_accessed_at = NOW()
      WHERE audio_sha256 = $1
        AND language = $2
        AND mode = $3
      RETURNING *
    `;

    const result = await this.handler.postgres.query(sql, [audioSha256, language, mode]);

    if (result.rows.length === 0) {
      debug('Cache miss: sha256=%s language=%s mode=%s', audioSha256, language, mode);
      return null;
    }

    const entry = result.rows[0];
    debug('Cache hit: sha256=%s language=%s mode=%s hit_count=%d', audioSha256, language, mode, entry.hit_count);
    return entry;
  }

  /**
   * Insert or update a cache entry.
   * On conflict (same audio_sha256 + language + mode), updates the stored keys
   * and resets last_accessed_at.
   * @param {string} audioSha256 - SHA-256 hash of the audio file
   * @param {string} language - Language code
   * @param {string} mode - Processing mode
   * @param {object} keys - Object storage keys for the cached artifacts
   * @param {string} [keys.subtitle_srt_key] - R2 key for the SRT subtitle file
   * @param {string} [keys.subtitle_vtt_key] - R2 key for the VTT subtitle file
   * @param {string} [keys.transcript_key] - R2 key for the transcript JSON
   * @returns {object} The upserted cache entry
   */
  async upsert(audioSha256, language, mode, keys = {}) {
    debug('Cache upsert: sha256=%s language=%s mode=%s keys=%O', audioSha256, language, mode, keys);

    const sql = `
      INSERT INTO media_cache (audio_sha256, language, mode, subtitle_srt_key, subtitle_vtt_key, transcript_key)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (audio_sha256, language, mode)
      DO UPDATE SET
        subtitle_srt_key = COALESCE(EXCLUDED.subtitle_srt_key, media_cache.subtitle_srt_key),
        subtitle_vtt_key = COALESCE(EXCLUDED.subtitle_vtt_key, media_cache.subtitle_vtt_key),
        transcript_key = COALESCE(EXCLUDED.transcript_key, media_cache.transcript_key),
        last_accessed_at = NOW()
      RETURNING *
    `;

    const params = [
      audioSha256,
      language,
      mode,
      keys.subtitle_srt_key || null,
      keys.subtitle_vtt_key || null,
      keys.transcript_key || null
    ];

    const result = await this.handler.postgres.query(sql, params);
    const entry = result.rows[0];

    debug('Cache upserted: sha256=%s language=%s mode=%s', audioSha256, language, mode);
    return entry;
  }
}

module.exports = MediaCache;
