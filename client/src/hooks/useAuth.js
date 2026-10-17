import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { AUTH_EXPIRED_EVENT } from '../api';

const TOKEN_KEY = 'syncscribe_token';
const USER_KEY = 'syncscribe_user';

/**
 * Authentication hook.
 * Manages user state and JWT token persistence via localStorage.
 */
export default function useAuth() {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  // Only "loading" if there is a token to validate. Visitors without one render
  // the landing page on the first frame (matching the prerendered markup).
  const [loading, setLoading] = useState(() => !!localStorage.getItem(TOKEN_KEY));
  const [error, setError] = useState(null);

  const isAuthenticated = !!user;

  /**
   * On mount, validate the existing token by calling /api/me.
   * If the token is invalid or expired, clear state.
   */
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    api.getMe()
      .then((userData) => {
        if (!cancelled) {
          setUser(userData);
          localStorage.setItem(USER_KEY, JSON.stringify(userData));
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Token is invalid or expired -- clear everything
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Sign out when any authenticated API call reports the session as expired
   * (see api.js). Ignore a stale 401 for a token that has since been replaced
   * by a fresh login.
   */
  useEffect(() => {
    const handleExpired = (e) => {
      const current = localStorage.getItem(TOKEN_KEY);
      if (current && e.detail?.token && e.detail.token !== current) return;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      setUser(null);
      setError('Your session has expired. Please sign in again.');
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
  }, []);

  /**
   * Log in with a Google OAuth credential.
   * Exchanges the credential for a JWT, stores it, and sets user state.
   */
  const login = useCallback(async (credential) => {
    setError(null);
    try {
      const { token, user: userData } = await api.googleLogin(credential);
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(userData));
      setUser(userData);
      return userData;
    } catch (err) {
      setError(err.message || 'Sign in failed');
      throw err;
    }
  }, []);

  /**
   * Log out -- clear token, user state, and localStorage.
   */
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setError(null);
  }, []);

  return useMemo(() => ({
    user,
    isAuthenticated,
    loading,
    error,
    login,
    logout
  }), [user, isAuthenticated, loading, error, login, logout]);
}
