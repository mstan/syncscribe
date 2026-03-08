import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import api from '../api';

/**
 * Job management hook.
 * Handles job creation, status polling, and lifecycle management.
 */
export default function useJob() {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [polling, setPolling] = useState(false);
  const intervalRef = useRef(null);

  /**
   * Stop the polling interval.
   */
  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
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
   * Start polling the job status every 2 seconds.
   * Stops automatically when job reaches a terminal state (succeeded / failed).
   */
  const pollStatus = useCallback((jobId) => {
    stopPolling();
    setPolling(true);

    const poll = async () => {
      try {
        const jobData = await api.getJob(jobId);
        setJob(jobData);

        if (jobData.status === 'succeeded' || jobData.status === 'failed') {
          stopPolling();
          if (jobData.status === 'failed') {
            setError(jobData.error_message || 'Job failed');
          }
        }
      } catch (err) {
        setError(err.message || 'Failed to check job status');
        stopPolling();
      }
    };

    // Poll immediately, then every 2 seconds
    poll();
    intervalRef.current = setInterval(poll, 2000);
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
   * Cleanup polling on unmount.
   */
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
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
