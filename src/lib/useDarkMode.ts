'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'clarion-theme';

function readPreference(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark') return true;
  if (stored === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/**
 * Reactive dark-mode hook. Reads the current attribute set by the pre-paint
 * script in layout.tsx, so the first render matches the painted theme.
 */
export function useDarkMode(): { isDark: boolean; toggle: () => void } {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-dark') === 'true';
    }
    return false;
  });

  useEffect(() => {
    setIsDark(readPreference());
  }, []);

  const toggle = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.setAttribute('data-dark', 'true');
        window.localStorage.setItem(STORAGE_KEY, 'dark');
      } else {
        document.documentElement.removeAttribute('data-dark');
        window.localStorage.setItem(STORAGE_KEY, 'light');
      }
      return next;
    });
  }, []);

  return { isDark, toggle };
}
