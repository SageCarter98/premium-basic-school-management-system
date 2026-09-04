/**
 * offline-db.test.ts
 *
 * FR-UX-020 (SRS v2.1): attendance/score entry offline storage. Genuinely
 * untested before this file — apps/web had zero test tooling until this
 * PR. Runs against fake-indexeddb (loaded in vitest.setup.ts), a real
 * IndexedDB implementation, not a hand-rolled mock — transactions, key
 * paths and onupgradeneeded all behave like the browser's own IndexedDB.
 *
 * Covers the storage layer's two real correctness properties: the queue
 * round-trips and prunes correctly, and different tenants never share a
 * database (spec §9.1's "cache is tenant-namespaced" / TEN-040).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cacheRosterData,
  clearOfflineDb,
  discardScoreEntry,
  getCachedRosterData,
  getQueuedAttendanceEntries,
  getQueuedScoreEntries,
  pruneSentEntries,
  pruneSentScoreEntries,
  queueAttendanceEntries,
  queueScoreEntries,
  updateQueuedEntryState,
  updateQueuedScoreEntryState,
  type PendingAttendanceEntry,
  type PendingScoreEntry,
} from './offline-db';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function attendanceEntry(overrides: Partial<PendingAttendanceEntry> = {}): PendingAttendanceEntry {
  return {
    clientId: `client-${Math.random().toString(36).slice(2)}`,
    studentId: 'student-1',
    classId: 'class-1',
    attendanceDate: '2026-09-04',
    status: 'present',
    deviceTimestamp: '2026-09-04T08:00:00.000Z',
    syncState: 'pending',
    queuedAt: '2026-09-04T08:00:00.000Z',
    ...overrides,
  };
}

function scoreEntry(overrides: Partial<PendingScoreEntry> = {}): PendingScoreEntry {
  return {
    clientId: `client-${Math.random().toString(36).slice(2)}`,
    componentId: 'component-1',
    studentId: 'student-1',
    status: 'scored',
    value: 85,
    syncState: 'pending',
    queuedAt: '2026-09-04T08:00:00.000Z',
    ...overrides,
  };
}

afterEach(async () => {
  await clearOfflineDb(TENANT_A);
  await clearOfflineDb(TENANT_B);
});

describe('queueAttendanceEntries / getQueuedAttendanceEntries', () => {
  it('round-trips entries through the queue', async () => {
    const entry = attendanceEntry();
    await queueAttendanceEntries(TENANT_A, [entry]);
    const entries = await getQueuedAttendanceEntries(TENANT_A);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(entry);
  });

  it('a second put with the same clientId updates rather than duplicates', async () => {
    const entry = attendanceEntry({ clientId: 'fixed-id', status: 'present' });
    await queueAttendanceEntries(TENANT_A, [entry]);
    await queueAttendanceEntries(TENANT_A, [{ ...entry, status: 'absent' }]);
    const entries = await getQueuedAttendanceEntries(TENANT_A);
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('absent');
  });
});

describe('updateQueuedEntryState', () => {
  it('merges a patch into the existing entry without dropping other fields', async () => {
    const entry = attendanceEntry({ clientId: 'fixed-id' });
    await queueAttendanceEntries(TENANT_A, [entry]);
    await updateQueuedEntryState(TENANT_A, 'fixed-id', { syncState: 'failed', failReason: 'network error' });
    const [updated] = await getQueuedAttendanceEntries(TENANT_A);
    expect(updated.syncState).toBe('failed');
    expect(updated.failReason).toBe('network error');
    expect(updated.studentId).toBe(entry.studentId); // untouched fields survive the merge
  });

  it('is a no-op when the clientId does not exist (nothing to merge into)', async () => {
    await expect(updateQueuedEntryState(TENANT_A, 'no-such-id', { syncState: 'sent' })).resolves.toBeUndefined();
    expect(await getQueuedAttendanceEntries(TENANT_A)).toHaveLength(0);
  });
});

describe('pruneSentEntries', () => {
  it('removes only entries in the sent state, keeping pending/sending/failed', async () => {
    await queueAttendanceEntries(TENANT_A, [
      attendanceEntry({ clientId: 'a', syncState: 'sent' }),
      attendanceEntry({ clientId: 'b', syncState: 'pending' }),
      attendanceEntry({ clientId: 'c', syncState: 'failed' }),
    ]);
    await pruneSentEntries(TENANT_A);
    const remaining = await getQueuedAttendanceEntries(TENANT_A);
    expect(remaining.map((e) => e.clientId).sort()).toEqual(['b', 'c']);
  });
});

describe('score queue (queueScoreEntries / getQueuedScoreEntries / discardScoreEntry / pruneSentScoreEntries)', () => {
  it('round-trips score entries independently of the attendance queue', async () => {
    await queueAttendanceEntries(TENANT_A, [attendanceEntry({ clientId: 'att-1' })]);
    await queueScoreEntries(TENANT_A, [scoreEntry({ clientId: 'score-1' })]);
    expect(await getQueuedAttendanceEntries(TENANT_A)).toHaveLength(1);
    expect(await getQueuedScoreEntries(TENANT_A)).toHaveLength(1);
  });

  it('discardScoreEntry removes exactly the targeted entry (the real fix for a stale 409, not retry)', async () => {
    await queueScoreEntries(TENANT_A, [
      scoreEntry({ clientId: 'keep', studentId: 'student-1' }),
      scoreEntry({ clientId: 'discard', studentId: 'student-2' }),
    ]);
    await discardScoreEntry(TENANT_A, 'discard');
    const remaining = await getQueuedScoreEntries(TENANT_A);
    expect(remaining.map((e) => e.clientId)).toEqual(['keep']);
  });

  it('updateQueuedScoreEntryState merges a patch the same way the attendance queue does', async () => {
    await queueScoreEntries(TENANT_A, [scoreEntry({ clientId: 'fixed-id' })]);
    await updateQueuedScoreEntryState(TENANT_A, 'fixed-id', { syncState: 'sent' });
    const [updated] = await getQueuedScoreEntries(TENANT_A);
    expect(updated.syncState).toBe('sent');
  });

  it('pruneSentScoreEntries removes only sent entries', async () => {
    await queueScoreEntries(TENANT_A, [
      scoreEntry({ clientId: 'a', syncState: 'sent' }),
      scoreEntry({ clientId: 'b', syncState: 'pending' }),
    ]);
    await pruneSentScoreEntries(TENANT_A);
    const remaining = await getQueuedScoreEntries(TENANT_A);
    expect(remaining.map((e) => e.clientId)).toEqual(['b']);
  });
});

describe('roster cache (cacheRosterData / getCachedRosterData)', () => {
  it('round-trips arbitrary cached data by key', async () => {
    await cacheRosterData(TENANT_A, 'roster:class-1', { students: ['s1', 's2'] });
    const cached = await getCachedRosterData<{ students: string[] }>(TENANT_A, 'roster:class-1');
    expect(cached).toEqual({ students: ['s1', 's2'] });
  });

  it('returns null for a key that was never cached', async () => {
    expect(await getCachedRosterData(TENANT_A, 'never-cached')).toBeNull();
  });
});

describe('tenant namespacing (spec §9.1 "cache is tenant-namespaced", TEN-040)', () => {
  it('two tenants never see each other\'s queued attendance entries', async () => {
    await queueAttendanceEntries(TENANT_A, [attendanceEntry({ clientId: 'a-only', studentId: 'tenant-a-student' })]);
    await queueAttendanceEntries(TENANT_B, [attendanceEntry({ clientId: 'b-only', studentId: 'tenant-b-student' })]);

    const aEntries = await getQueuedAttendanceEntries(TENANT_A);
    const bEntries = await getQueuedAttendanceEntries(TENANT_B);
    expect(aEntries.map((e) => e.clientId)).toEqual(['a-only']);
    expect(bEntries.map((e) => e.clientId)).toEqual(['b-only']);
  });

  it('clearOfflineDb only clears the named tenant, leaving the other intact', async () => {
    await queueAttendanceEntries(TENANT_A, [attendanceEntry({ clientId: 'a-entry' })]);
    await queueAttendanceEntries(TENANT_B, [attendanceEntry({ clientId: 'b-entry' })]);

    await clearOfflineDb(TENANT_A);

    expect(await getQueuedAttendanceEntries(TENANT_A)).toHaveLength(0);
    expect(await getQueuedAttendanceEntries(TENANT_B)).toHaveLength(1);
  });
});
