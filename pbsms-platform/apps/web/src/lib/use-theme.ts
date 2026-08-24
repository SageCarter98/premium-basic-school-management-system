'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'pbsms.theme';
export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * Applies data-theme to <html> so tokens.css's dark overrides
 * (`:root[data-theme='dark']`) take effect — "system" leaves the
 * attribute unset entirely so tokens.css's prefers-color-scheme branch
 * decides instead. layout.tsx's inline THEME_INIT_SCRIPT applies the
 * stored preference before first paint (same flash-of-wrong-theme problem
 * useDataSaver()/useSidebarCollapsed() don't have, since those don't
 * change what's already painted — a theme does); this hook just keeps
 * React's state in sync with that after mount and re-applies it on change.
 */
export function useTheme(): [ThemePreference, (value: ThemePreference) => void] {
  const [theme, setTheme] = useState<ThemePreference>('system');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
    setTheme(stored ?? 'system');
  }, []);

  function set(value: ThemePreference) {
    localStorage.setItem(STORAGE_KEY, value);
    if (value === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', value);
    }
    setTheme(value);
  }

  return [theme, set];
}

// Inlined verbatim into layout.tsx's <head> so the stored preference is
// applied before first paint — a useEffect-only approach would paint the
// wrong theme for one frame, then visibly snap to the right one.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
