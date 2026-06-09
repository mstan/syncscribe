import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import api from '../api';

// Safety-net poll interval. The live SSE stream drives updates; this only fires
// if the stream is delayed/blocked (e.g. a buffering proxy) so progress is never
// fully stuck. Far slower than the old 2s poll, so it doesn't spam the server.
const FALLBACK_POLL_MS = 10000;

const isTerminal = (status) => status === 'succeeded' || status === 'failed' || status === 'cancelled';

/**
 * Job management hook.
 * Handles job creation, live status updates (SSE), and lifecycle management.
 */
export default function useJob() {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [polling, setPolling] = useState(false);
  const sourceRef = useRef(null);
  const fallbackRef = useRef(null);

  /**
   * Tear down the live stream and fallback poll.
   */
  const stopPolling = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    if (fallbackRef.current) {
      clearInterval(fallbackRef.current);
      fallbackRef.current = null;
    }
    setPolling(false);
  }, []);

  /**
   * Create a new transcription job via the API.
   * @param {Object} data - { audio_sha256, audio_seconds, language, additional_languages }
   * @returns {{ job, upload_url }}
   */
  const createJob = useCallback(async (data) => {
    setError(null);
    try {
      const result = await api.createJob(data);
      setJob(result.job);
      return result;
    } catch (err) {
      setError(err.message || 'Failed to create job');
      throw err;
    }
  }, []);

  /**
   * Watch a job for status/stage changes via the SSE stream, with a slow
   * fallback poll as a safety net. Tears down automatically when the job
   * reaches a terminal state (succeeded / failed / cancelled).
   *
   * Named pollStatus for backwards compatibility with existing callers.
   */
  const pollStatus = useCallback((jobId) => {
    stopPolling();
    setPolling(true);

    const apply = (jobData) => {
      setJob(jobData);
      if (isTerminal(jobData.status)) {
        if (jobData.status === 'failed') {
          setError(jobData.error_message || 'Job failed');
        }
        stopPolling();
      }
    };

    // One-shot fetch used by the fallback timer (and if the stream errors).
    const fetchOnce = async () => {
      try {
        apply(await api.getJob(jobId));
      } catch (err) {
        // Transient fetch errors are non-fatal here — the stream or the next
        // fallback tick will recover. Only surface if nothing is connected.
        if (!sourceRef.current) {
          setError(err.message || 'Failed to check job status');
          stopPolling();
        }
      }
    };

    // Live updates via Server-Sent Events.
    try {
      const source = new EventSource(api.jobEventsUrl(jobId));
      sourceRef.current = source;

      source.onmessage = (evt) => {
        try {
          apply(JSON.parse(evt.data));
        } catch {
          // Ignore malformed frames (e.g. heartbeat comments never reach here).
        }
      };

      source.onerror = () => {
        // The browser auto-reconnects EventSource; meanwhile, fall back to a
        // one-shot fetch so a dropped stream can't strand the UI.
        fetchOnce();
      };
    } catch {
      // EventSource unavailable — fetch immediately and rely on the fallback poll.
      fetchOnce();
    }

    // Safety-net poll (slow) regardless of stream health.
    fetchOnce();
    fallbackRef.current = setInterval(fetchOnce, FALLBACK_POLL_MS);
  }, [stopPolling]);

  /**
   * Reset all job state.
   */
  const reset = useCallback(() => {
    stopPolling();
    setJob(null);
    setError(null);
  }, [stopPolling]);

  /**
   * Cleanup on unmount.
   */
  useEffect(() => {
    return () => {
      if (sourceRef.current) sourceRef.current.close();
      if (fallbackRef.current) clearInterval(fallbackRef.current);
    };
  }, []);

  return useMemo(() => ({
    job,
    error,
    polling,
    createJob,
    pollStatus,
    reset,
    setError
  }), [job, error, polling, createJob, pollStatus, reset]);
}
