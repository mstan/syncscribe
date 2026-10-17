import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import api from '../api';

// Safety-net poll interval. The live SSE stream drives updates; this only fires
// if the stream is delayed/blocked (e.g. a buffering proxy) so progress is never
// fully stuck. Far slower than the old 2s poll, so it doesn't spam the server.
const FALLBACK_POLL_MS = 10000;

// How long to wait before reopening an event stream the browser gave up on
// (EventSource only auto-retries network drops, not error responses).
const RECONNECT_MS = 5000;

const isTerminal = (status) => status === 'succeeded' || status === 'failed' || status === 'cancelled';

/**
 * Errors that retrying won't fix: expired session, lost access, deleted job.
 */
function fatalStatusMessage(err) {
  switch (err?.status) {
    case 401: return 'Your session has expired. Please sign in again to check on this job.';
    case 403: return 'You no longer have access to this job.';
    case 404: return 'This job could not be found.';
    default: return null;
  }
}

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
  const reconnectRef = useRef(null);
  // Bumped on every start/stop so callbacks from a superseded watch are ignored.
  const watchIdRef = useRef(0);

  /**
   * Tear down the live stream, pending reconnect, and fallback poll.
   */
  const stopPolling = useCallback(() => {
    watchIdRef.current++;
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
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
    const watchId = watchIdRef.current;
    const isCurrent = () => watchIdRef.current === watchId;

    const apply = (jobData) => {
      if (!isCurrent()) return;
      setJob(jobData);
      if (isTerminal(jobData.status)) {
        if (jobData.status === 'failed') {
          setError(jobData.error_message || 'Job failed');
        }
        stopPolling();
      }
    };

    // One-shot fetch used by the fallback timer and whenever the stream errors.
    // EventSource can't expose the HTTP status of a failed connection, so this
    // fetch is how an expired token (401) is detected.
    const fetchOnce = async () => {
      try {
        apply(await api.getJob(jobId));
      } catch (err) {
        if (!isCurrent()) return;
        const fatal = fatalStatusMessage(err);
        if (fatal) {
          // Retrying can't fix this; stop the stream (else it reconnects forever)
          // and surface it. A 401 also signs the user out via api.js -> useAuth.
          setError(fatal);
          stopPolling();
        } else if (!sourceRef.current && !reconnectRef.current) {
          // Transient fetch errors are non-fatal while a stream is up or about to
          // reconnect — it or the next fallback tick will recover. Only surface
          // if nothing is connected.
          setError(err.message || 'Failed to check job status');
          stopPolling();
        }
      }
    };

    // Live updates via Server-Sent Events.
    const connect = async () => {
      if (!isCurrent()) return;
      reconnectRef.current = null;
      let url;
      try {
        url = await api.jobEventsUrl(jobId);
      } catch {
        // Couldn't get a stream token; fetchOnce surfaces fatal errors (401/403/404),
        // otherwise retry the stream later. The fallback poll covers the gap.
        if (!isCurrent()) return;
        if (!reconnectRef.current) reconnectRef.current = setTimeout(connect, RECONNECT_MS);
        fetchOnce();
        return;
      }
      if (!isCurrent()) return;
      try {
        const source = new EventSource(url);
        sourceRef.current = source;

        source.onmessage = (evt) => {
          try {
            apply(JSON.parse(evt.data));
          } catch {
            // Ignore malformed frames (e.g. heartbeat comments never reach here).
          }
        };

        source.onerror = () => {
          if (!isCurrent()) return;
          // Network drops auto-reconnect (readyState CONNECTING); an error
          // response closes the stream for good (CLOSED), so reopen it later
          // unless fetchOnce finds the error is fatal and stops the watch.
          if (source.readyState === EventSource.CLOSED) {
            source.close();
            if (sourceRef.current === source) sourceRef.current = null;
            if (!reconnectRef.current) reconnectRef.current = setTimeout(connect, RECONNECT_MS);
          }
          fetchOnce();
        };
      } catch {
        // EventSource unavailable — rely on the fallback poll.
        sourceRef.current = null;
      }
    };
    connect();

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
      watchIdRef.current++;
      if (sourceRef.current) sourceRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
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
