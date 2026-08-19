'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'pbsms.dataSaver';

interface NetworkInformation {
  effectiveType?: string;
  saveData?: boolean;
}

function detectDefault(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as { connection?: NetworkInformation }).connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  return connection.effectiveType === '2g' || connection.effectiveType === '3g' || connection.effectiveType === 'slow-2g';
}

/**
 * Spec §9.3 (a v1.0 gap this v1.1 spec closes): "off by default on
 * Wi-Fi-detected connections... on by default when the connection is
 * detected as 2G/3G or save-data is signalled." Persisted per DEVICE, not
 * per session (localStorage, not sessionStorage — deliberately the
 * opposite storage choice from useParentToken(), which IS per-session for
 * a different reason: a guardian on a fixed data plan shouldn't re-decide
 * this every visit, but a shared device's active child link should not
 * survive the tab closing).
 *
 * Honest scope note (see apps/web/README.md's Stage 6 section): this
 * build has no student photos, no generated PDFs, and no analytics
 * charts on Parent View yet — so the toggle exists and persists exactly
 * as the spec requires, but has nothing costly to actually defer today.
 * Its real effect arrives once those exist.
 */
export function useDataSaver(): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    setEnabled(stored !== null ? stored === 'true' : detectDefault());
  }, []);

  function set(value: boolean) {
    localStorage.setItem(STORAGE_KEY, String(value));
    setEnabled(value);
  }

  return [enabled, set];
}
