// lib/R2.js
const debug = require('debug')('SubtitleGenerator:R2');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

class R2 {
  constructor(handler) {
    this.handler = handler;
    this.endpoint = process.env.R2_ENDPOINT;
    this.accessKeyId = process.env.R2_ACCESS_KEY_ID;
    this.secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    this.bucket = process.env.R2_BUCKET;
    this.client = null;
  }

  async init() {
    debug('Initializing R2 storage service');

    if (!this.endpoint) {
      throw new Error('R2_ENDPOINT environment variable is required');
    }
    if (!this.accessKeyId) {
      throw new Error('R2_ACCESS_KEY_ID environment variable is required');
    }
    if (!this.secretAccessKey) {
      throw new Error('R2_SECRET_ACCESS_KEY environment variable is required');
    }
    if (!this.bucket) {
      throw new Error('R2_BUCKET environment variable is required');
    }

    this.client = new S3Client({
      region: 'auto',
      endpoint: this.endpoint,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey
      }
    });

    debug('R2 client initialized (endpoint=%s bucket=%s)', this.endpoint, this.bucket);
  }

  /**
   * Upload a buffer to R2.
   * @param {string} key - Object key
   * @param {Buffer} buffer - File content
   * @param {string} contentType - MIME type
   * @returns {object} PutObject response
   */
  async uploadBuffer(key, buffer, contentType) {
    debug('Uploading to R2: key=%s size=%d contentType=%s', key, buffer.length, contentType);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType
    });

    const response = await this.client.send(command);
    debug('Upload complete: key=%s', key);
    return response;
  }

  /**
   * Download an object from R2 as a Buffer.
   * @param {string} key - Object key
   * @returns {Buffer} File content
   */
  async downloadBuffer(key) {
    debug('Downloading from R2: key=%s', key);

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    const response = await this.client.send(command);

    // Convert the readable stream to a buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    debug('Download complete: key=%s size=%d', key, buffer.length);
    return buffer;
  }

  /**
   * Check if an object exists in R2.
   * @param {string} key - Object key
   * @returns {boolean} True if the object exists
   */
  async exists(key) {
    debug('Checking existence in R2: key=%s', key);

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      await this.client.send(command);
      debug('Object exists: key=%s', key);
      return true;
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        debug('Object not found: key=%s', key);
        return false;
      }
      debug('HeadObject error for key=%s: %s', key, err.message);
      throw err;
    }
  }

  /**
   * Generate a presigned URL for uploading (PUT) an object.
   * @param {string} key - Object key
   * @param {number} [expiresIn=3600] - URL expiry in seconds
   * @returns {string} Presigned PUT URL
   */
  async getPresignedUploadUrl(key, expiresIn = 3600) {
    debug('Generating presigned upload URL: key=%s expiresIn=%d', key, expiresIn);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    const url = await getSignedUrl(this.client, command, { expiresIn });
    debug('Presigned upload URL generated for key=%s', key);
    return url;
  }

  /**
   * Generate a presigned URL for downloading (GET) an object.
   * @param {string} key - Object key
   * @param {number} [expiresIn=3600] - URL expiry in seconds
   * @returns {string} Presigned GET URL
   */
  async getPresignedDownloadUrl(key, expiresIn = 3600, fileName = null) {
    debug('Generating presigned download URL: key=%s expiresIn=%d', key, expiresIn);

    const params = {
      Bucket: this.bucket,
      Key: key
    };
    if (fileName) {
      params.ResponseContentDisposition = `attachment; filename="${fileName}"`;
    }

    const command = new GetObjectCommand(params);

    const url = await getSignedUrl(this.client, command, { expiresIn });
    debug('Presigned download URL generated for key=%s', key);
    return url;
  }

  /**
   * Delete an object from R2.
   * @param {string} key - Object key
   * @returns {object} DeleteObject response
   */
  async deleteObject(key) {
    debug('Deleting from R2: key=%s', key);

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    const response = await this.client.send(command);
    debug('Delete complete: key=%s', key);
    return response;
  }

  // ── Key helpers ──────────────────────────────────────────────────────

  /**
   * Generate the R2 key for an audio file.
   * @param {string} sha256 - SHA-256 hash of the audio
   * @returns {string} Object key
   */
  audioKey(sha256) {
    return `audio/${sha256}.flac`;
  }

  /**
   * Generate the R2 key for a subtitle file.
   * @param {string} sha256 - SHA-256 hash of the source audio
   * @param {string} language - Language code
   * @param {string} format - Subtitle format ('srt' or 'vtt')
   * @returns {string} Object key
   */
  subtitleKey(sha256, language, format) {
    return `subs/${sha256}/${language}.${format}`;
  }

  /**
   * Generate the R2 key for a transcript JSON file.
   * @param {string} sha256 - SHA-256 hash of the source audio
   * @param {string} language - Language code
   * @returns {string} Object key
   */
  transcriptKey(sha256, language) {
    return `transcripts/${sha256}/${language}.json`;
  }
}

module.exports = R2;
