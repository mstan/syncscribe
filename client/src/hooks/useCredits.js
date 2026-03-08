import { useState, useCallback, useEffect, useMemo } from 'react';
import api from '../api';

/**
 * Credits hook.
 * Manages the user's credit balance with auto-refresh on mount.
 */
export default function useCredits(isAuthenticated) {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Fetch the latest credit balance from the API.
   */
  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;

    setLoading(true);
    setError(null);
    try {
      const data = await api.getCredits();
      setBalance(data.balance);
    } catch (err) {
      setError(err.message || 'Failed to load credits');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  /**
   * Auto-refresh on mount and when authentication status changes.
   */
  useEffect(() => {
    if (isAuthenticated) {
      refresh();
    } else {
      setBalance(null);
    }
  }, [isAuthenticated, refresh]);

  return useMemo(() => ({
    balance,
    loading,
    error,
    refresh
  }), [balance, loading, error, refresh]);
}
