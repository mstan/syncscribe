import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api';

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
  const [loading, setLoading] = useState(true);
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
