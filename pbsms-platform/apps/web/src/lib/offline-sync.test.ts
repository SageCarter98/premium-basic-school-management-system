/**
 * offline-sync.test.ts
 *
 * FR-UX-020: the orchestration layer that decides whether a write goes
 * straight to the network or into the IndexedDB queue, per FR-ATT-011's
 * conflict rule and the offline-first "queues, never blocks" contract
 * (spec §9.1). Genuinely untested before this file.
 *
 * Mocks global.fetch directly rather than mocking apiFetch/api-client --
 * apiFetch is a thin wrapper (adds auth headers, retries once on 401) over
 * fetch, so mocking at the fetch level exercises the real apiFetch code
 * path instead of assuming its behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOfflineDb, getQueuedAttendanceEntries, getQueuedScoreEntries } from './offline-db';
import {
  discardScoreEntry,
  flushQueueNow,
  flushScoreQueueNow,
  submitAttendanceEntries,
  submitScoreEntries,
} from './offline-sync';

const TENANT = 'tenant-sync-test';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  // apiFetch reads a bearer token via getAccessToken() (localStorage) --
  // absent is fine, it just omits the Authorization header, same as an
  // unauthenticated request would in the real app.
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(async () => {
  await clearOfflineDb(TENANT);
  vi.unstubAllGlobals();
});

describe('submitAttendanceEntries', () => {
  it('online success: nothing is queued once every entry comes back created', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([{ outcome: 'created', entry: {} }]));

    await submitAttendanceEntries(TENANT, [
      { studentId: 's1', classId: 'c1', attendanceDate: '2026-09-04', status: 'present' },
    ]);

    expect(await getQueuedAttendanceEntries(TENANT)).toHaveLength(0);
  });

  it('a genuine network failure queues every mark as pending (the "queues, never blocks" contract)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));

    await submitAttendanceEntries(TENANT, [
      { studentId: 's1', classId: 'c1', attendanceDate: '2026-09-04', status: 'present' },
    ]);

    const queued = await getQueuedAttendanceEntries(TENANT);
    expect(queued).toHaveLength(1);
    expect(queued[0].syncState).toBe('pending');
  });

  it('a server-reported conflict is queued as failed with the conflictId, not silently dropped or retried blindly', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse([{ outcome: 'conflict', entry: {}, conflictId: 'conflict-1' }]),
    );

    await submitAttendanceEntries(TENANT, [
      { studentId: 's1', classId: 'c1', attendanceDate: '2026-09-04', status: 'present' },
    ]);

    const queued = await getQueuedAttendanceEntries(TENANT);
    expect(queued).toHaveLength(1);
    expect(queued[0].syncState).toBe('failed');
    expect(queued[0].conflictId).toBe('conflict-1');
  });

  it('does nothing for an empty mark list (no fetch call at all)', async () => {
    await submitAttendanceEntries(TENANT, []);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('flushQueueNow', () => {
  it('retries queued entries, applies fresh outcomes, and prunes the ones that succeed', async () => {
    // First attempt (submitAttendanceEntries) fails at the fetch level,
    // landing the entry in the queue as 'pending'.
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await submitAttendanceEntries(TENANT, [
      { studentId: 's1', classId: 'c1', attendanceDate: '2026-09-04', status: 'present' },
    ]);
    expect((await getQueuedAttendanceEntries(TENANT))[0].syncState).toBe('pending');

    // Now connectivity returns — flushQueueNow retries and this time succeeds.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([{ outcome: 'created', entry: {} }]));
    await flushQueueNow(TENANT);

    // pruneSentEntries runs at the end of a successful flush, so a fully-sent
    // entry is gone from the queue entirely rather than lingering as 'sent'.
    expect(await getQueuedAttendanceEntries(TENANT)).toHaveLength(0);
  });

  it('does nothing when the queue is empty (no fetch call)', async () => {
    await flushQueueNow(TENANT);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('submitScoreEntries', () => {
  it('online success: nothing is queued', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));

    await submitScoreEntries(TENANT, [{ componentId: 'comp-1', studentId: 's1', status: 'scored', value: 90 }]);

    expect(await getQueuedScoreEntries(TENANT)).toHaveLength(0);
  });

  it('a genuine network failure queues the mark as pending', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));

    await submitScoreEntries(TENANT, [{ componentId: 'comp-1', studentId: 's1', status: 'scored', value: 90 }]);

    const queued = await getQueuedScoreEntries(TENANT);
    expect(queued).toHaveLength(1);
    expect(queued[0].syncState).toBe('pending');
  });

  it('a definitive 409 version conflict is recorded as failed immediately, not silently dropped', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'Another teacher already scored this.' }, 409));

    await submitScoreEntries(TENANT, [
      { componentId: 'comp-1', studentId: 's1', status: 'scored', value: 90, expectedVersion: 1 },
    ]);

    const queued = await getQueuedScoreEntries(TENANT);
    expect(queued).toHaveLength(1);
    expect(queued[0].syncState).toBe('failed');
    expect(queued[0].failReason).toBe('Another teacher already scored this.');
  });
});

describe('flushScoreQueueNow', () => {
  it('a 409 conflict from a retried flush stays failed forever until discarded (honest limitation, unlike attendance)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'stale version' }, 409));
    await submitScoreEntries(TENANT, [
      { componentId: 'comp-1', studentId: 's1', status: 'scored', value: 90, expectedVersion: 1 },
    ]);
    expect((await getQueuedScoreEntries(TENANT))[0].syncState).toBe('failed');

    // Retrying resends the exact same (now-stale) expectedVersion -- fails the same way.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'stale version' }, 409));
    await flushScoreQueueNow(TENANT);
    const stillQueued = await getQueuedScoreEntries(TENANT);
    expect(stillQueued).toHaveLength(1);
    expect(stillQueued[0].syncState).toBe('failed');

    // discardScoreEntry is the actual fix -- removes the stale entry outright.
    await discardScoreEntry(TENANT, stillQueued[0].clientId);
    expect(await getQueuedScoreEntries(TENANT)).toHaveLength(0);
  });

  it('a successful retry prunes the entry from the queue', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await submitScoreEntries(TENANT, [{ componentId: 'comp-1', studentId: 's1', status: 'scored', value: 90 }]);
    expect((await getQueuedScoreEntries(TENANT))[0].syncState).toBe('pending');

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));
    await flushScoreQueueNow(TENANT);

    expect(await getQueuedScoreEntries(TENANT)).toHaveLength(0);
  });
});
