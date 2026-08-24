'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'pbsms.sidebarCollapsed';

/**
 * Desktop-only sidebar collapse (icon-rail width), independent of the
 * existing mobile drawer open/close state in AppShell. Persisted per
 * DEVICE (localStorage), same storage choice and read-after-mount shape
 * as useDataSaver() — avoids a server/client render mismatch since
 * localStorage doesn't exist during SSR.
 */
export function useSidebarCollapsed(): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === 'true');
  }, []);

  function set(value: boolean) {
    localStorage.setItem(STORAGE_KEY, String(value));
    setCollapsed(value);
  }

  return [collapsed, set];
}
