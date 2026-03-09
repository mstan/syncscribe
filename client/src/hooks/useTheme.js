import { useState, useEffect, useCallback } from 'react';

/**
 * useTheme -- manages dark mode with system detection and manual toggle.
 * Reads initial state from <html> class and localStorage.
 * theme: 'system' | 'dark' | 'light'
 */
export default function useTheme() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'system';
  });

  const apply = useCallback((t) => {
    const isDark =
      t === 'dark' ||
      (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  useEffect(() => {
    apply(theme);

    if (theme === 'system') {
      localStorage.removeItem('theme');
    } else {
      localStorage.setItem('theme', theme);
    }
  }, [theme, apply]);

  // Listen for system preference changes when in system mode
  useEffect(() => {
    if (theme !== 'system') return;

    const mq = matchMedia('(prefers-color-scheme: dark)');
    const handler = () => apply('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, apply]);

  const toggle = useCallback(() => {
    setTheme(prev => {
      if (prev === 'system') return 'dark';
      if (prev === 'dark') return 'light';
      return 'system';
    });
  }, []);

  return { theme, toggle };
}
