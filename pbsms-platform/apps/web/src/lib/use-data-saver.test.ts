/**
 * use-data-saver.test.ts
 *
 * FR-UX-040 (spec §9.3, a v1.0 gap v1.1 closed): "off by default on
 * Wi-Fi-detected connections... on by default when the connection is
 * detected as 2G/3G or save-data is signalled." Cited by ID in
 * use-data-saver.ts's own comments before this file existed --
 * detect-spec-gaps.ts correctly flagged that as "referenced but untested."
 * Genuinely untested before this file: no suite constructed the hook or
 * exercised detectDefault()'s branches at all.
 *
 * jsdom does not implement the Network Information API
 * (navigator.connection), so each case defines/removes it directly via
 * Object.defineProperty rather than relying on a browser default.
 *
 * Covers:
 *  - detectDefault()'s three signals: saveData=true, each slow
 *    effectiveType (2g/3g/slow-2g), and the "no signal" cases (no
 *    connection object at all, or a fast effectiveType) -- proving both
 *    halves of the spec quote, not just the "on" half.
 *  - Persistence is per-device (localStorage), and a stored value wins
 *    over live detection even when they'd disagree -- the hook does not
 *    silently override a user's own prior choice on every render.
 *  - set() both updates the returned state and persists it, so a second
 *    mount picks up the change without needing detectDefault() again.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDataSaver } from './use-data-saver';

const STORAGE_KEY = 'pbsms.dataSaver';

function setConnection(value: { saveData?: boolean; effectiveType?: string } | undefined) {
  if (value === undefined) {
    delete (navigator as { connection?: unknown }).connection;
    return;
  }
  Object.defineProperty(navigator, 'connection', { value, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  setConnection(undefined);
});

afterEach(() => {
  localStorage.clear();
  setConnection(undefined);
});

describe('detectDefault() via first mount with nothing stored', () => {
  it('defaults off when there is no connection info at all (e.g. Wi-Fi, spec\'s "off by default" case)', () => {
    const { result } = renderHook(() => useDataSaver());
    expect(result.current[0]).toBe(false);
  });

  it('defaults off on a fast connection with saveData not signalled', () => {
    setConnection({ effectiveType: '4g', saveData: false });
    const { result } = renderHook(() => useDataSaver());
    expect(result.current[0]).toBe(false);
  });

  it('defaults on when connection.saveData is signalled, regardless of effectiveType', () => {
    setConnection({ effectiveType: '4g', saveData: true });
    const { result } = renderHook(() => useDataSaver());
    expect(result.current[0]).toBe(true);
  });

  it.each(['2g', '3g', 'slow-2g'])('defaults on for a %s effectiveType even with saveData unset', (effectiveType) => {
    setConnection({ effectiveType });
    const { result } = renderHook(() => useDataSaver());
    expect(result.current[0]).toBe(true);
  });
});

describe('persistence (per-device, not per-session)', () => {
  it('set(true) persists to localStorage and updates the returned state immediately', () => {
    const { result } = renderHook(() => useDataSaver());
    expect(result.current[0]).toBe(false);

    act(() => result.current[1](true));

    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('a stored value wins over live detection, even when they disagree', () => {
    // A user on a slow connection explicitly turned data saver OFF --
    // the next mount must respect that, not re-run detectDefault() and
    // silently flip it back on.
    localStorage.setItem(STORAGE_KEY, 'false');
    setConnection({ effectiveType: '2g' });

    const { result } = renderHook(() => useDataSaver());
    expect(result.current[0]).toBe(false);
  });

  it('a second mount picks up a prior set() without needing detectDefault() again', () => {
    const first = renderHook(() => useDataSaver());
    act(() => first.result.current[1](true));

    // No connection info at all on the second mount -- detectDefault()
    // alone would say "off"; the persisted value must win instead.
    const second = renderHook(() => useDataSaver());
    expect(second.result.current[0]).toBe(true);
  });
});
