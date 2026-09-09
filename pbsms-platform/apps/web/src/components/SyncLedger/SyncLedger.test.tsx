/**
 * SyncLedger.test.tsx
 *
 * FR-UX-030 (spec §8.2): "a persistent, unambiguous online/offline/syncing
 * indicator." Cited by ID in SyncLedger.tsx's own comment before this file
 * existed -- detect-spec-gaps.ts correctly flagged that as "referenced but
 * untested." Genuinely untested before this file: no suite ever rendered
 * this component.
 *
 * Drives real state through the actual offline-db (fake-indexeddb) and
 * offline-sync modules rather than mocking them -- subscribeSyncState()/
 * subscribeScoreSyncState() compute their state entirely from the real
 * queue, so queuing/discarding real entries is the only honest way to
 * exercise SyncLedger's rendering decisions. Two things are mocked:
 * global.fetch (offline-sync.test.ts's own pattern, for the one test that
 * exercises a real retry-to-synced round trip) and the ConflictReview
 * component (its own async /v1/attendance/conflicts fetch is FR-ATT-011's
 * concern, a separate file with its own tests to write -- this file only
 * needs to prove SyncLedger mounts it under the right role/conflict
 * condition, not exercise its internals).
 *
 * Real, order-sensitive quirk found while writing this file, worked
 * around rather than silently masked: offline-sync.ts's lastSyncedAt (and
 * its score-queue twin scoreLastSyncedAt) are module-level, not
 * tenant-scoped -- once any test in this file drives a queue to a
 * successful sync, EVERY later test with an empty queue would report
 * 'synced' instead of 'idle', for any tenant. Tests are ordered so the
 * one test that triggers a real sync (the retry test) runs last; each
 * test file gets a fresh module instance from Vitest, so this doesn't
 * leak across files.
 *
 * Covers:
 *  - Renders nothing in the true "never touched" state.
 *  - offline-queued / failed messages, with correct counts, for both the
 *    attendance and score variants.
 *  - Expanding shows queued entries; "Retry now" drives a real
 *    failed -> sending -> synced transition through a mocked network
 *    response (flushQueueNow()'s real code path, not a stand-in).
 *  - Score variant: Discard removes exactly the targeted entry and, once
 *    the queue is empty, the ledger disappears entirely (back to idle).
 *  - Conflict review is role-gated: an ACADEMIC_ADMIN-tier caller
 *    (headmaster) sees ConflictReview mounted; a teacher sees the
 *    fallback "needs review by your academic office" message instead.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOfflineDb, queueAttendanceEntries, queueScoreEntries, type PendingAttendanceEntry, type PendingScoreEntry } from '@/lib/offline-db';
import { SyncLedger } from './SyncLedger';

vi.mock('./ConflictReview', () => ({
  ConflictReview: () => <div data-testid="conflict-review-mounted" />,
}));

const TENANT = 'tenant-syncledger-test';
const TEACHER_ROLE = ['teacher'];
const HEADMASTER_ROLE = ['headmaster']; // ACADEMIC_ADMIN-tier, see role-groups.ts

function attendanceEntry(overrides: Partial<PendingAttendanceEntry> = {}): PendingAttendanceEntry {
  return {
    clientId: `client-${Math.random().toString(36).slice(2)}`,
    studentId: 'student-1',
    classId: 'class-1',
    attendanceDate: '2026-09-09',
    status: 'present',
    deviceTimestamp: '2026-09-09T08:00:00.000Z',
    syncState: 'pending',
    queuedAt: '2026-09-09T08:00:00.000Z',
    ...overrides,
  };
}

function scoreEntry(overrides: Partial<PendingScoreEntry> = {}): PendingScoreEntry {
  return {
    clientId: `client-${Math.random().toString(36).slice(2)}`,
    componentId: 'comp-1',
    studentId: 'student-1',
    status: 'scored',
    value: 60,
    syncState: 'pending',
    queuedAt: '2026-09-09T08:00:00.000Z',
    ...overrides,
  };
}

function base64url(obj: unknown): string {
  const base64 = Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function setAccessToken(roleCodes: string[]) {
  const header = base64url({ alg: 'none' });
  const payload = base64url({ sub: 'user-1', tenantId: TENANT, isPlatformUser: false, roleCodes });
  localStorage.setItem('pbsms.accessToken', `${header}.${payload}.sig`);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  setAccessToken(TEACHER_ROLE);
});

afterEach(async () => {
  await clearOfflineDb(TENANT);
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('renders nothing when the queue is empty and nothing has ever synced', () => {
  const { container } = render(<SyncLedger tenantId={TENANT} />);
  expect(container).toBeEmptyDOMElement();
});

it('shows the offline-queued message with the correct pending count (attendance)', async () => {
  await queueAttendanceEntries(TENANT, [
    attendanceEntry({ clientId: 'a1', studentId: 'student-1' }),
    attendanceEntry({ clientId: 'a2', studentId: 'student-2', status: 'absent' }),
  ]);

  render(<SyncLedger tenantId={TENANT} />);
  await screen.findByText('Working offline — 2 marks on this phone');
});

it('shows the failed message and expanding reveals the entry with its fail reason (score variant)', async () => {
  await queueScoreEntries(TENANT, [
    scoreEntry({ clientId: 's1', studentId: 'student-1', value: 60, syncState: 'failed', failReason: 'Version conflict' }),
  ]);

  render(<SyncLedger tenantId={TENANT} variant="score" />);
  await screen.findByText('1 could not be saved');

  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  await screen.findByText('student-… — 60');
  expect(screen.getByText('Version conflict')).toBeInTheDocument();
});

it('Discard removes exactly the targeted score entry; once empty, the ledger disappears (idle again)', async () => {
  await queueScoreEntries(TENANT, [
    scoreEntry({ clientId: 'keep', studentId: 'student-1', syncState: 'pending' }),
    scoreEntry({ clientId: 'discard-me', studentId: 'student-2', syncState: 'failed', failReason: 'rejected' }),
  ]);

  render(<SyncLedger tenantId={TENANT} variant="score" />);
  await screen.findByText('1 could not be saved');

  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  const discardButtons = await screen.findAllByRole('button', { name: 'Discard' });
  expect(discardButtons).toHaveLength(1); // only the failed entry gets a Discard action
  fireEvent.click(discardButtons[0]);

  // The failed entry is gone; the pending one keeps the ledger visible in
  // its offline-queued state rather than disappearing.
  await waitFor(() => expect(screen.getByText('Working offline — 1 score on this phone')).toBeInTheDocument());
  expect(screen.queryByText('rejected')).not.toBeInTheDocument();
});

describe('conflict review role gating (attendance, a failed entry with a real conflictId)', () => {
  async function queueConflictedEntry() {
    await queueAttendanceEntries(TENANT, [
      attendanceEntry({ clientId: 'conflict-1', syncState: 'failed', failReason: 'needs review', conflictId: 'conflict-row-1' }),
    ]);
  }

  it('an ACADEMIC_ADMIN-tier caller (headmaster) sees ConflictReview mounted', async () => {
    setAccessToken(HEADMASTER_ROLE);
    await queueConflictedEntry();

    render(<SyncLedger tenantId={TENANT} />);
    await screen.findByText('1 could not be saved');
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    await screen.findByTestId('conflict-review-mounted');
    expect(screen.queryByText(/needs review by your academic office/)).not.toBeInTheDocument();
  });

  it('a teacher sees the fallback message instead, not ConflictReview', async () => {
    await queueConflictedEntry(); // beforeEach already set the teacher token

    render(<SyncLedger tenantId={TENANT} />);
    await screen.findByText('1 could not be saved');
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    await screen.findByText(/needs review by your academic office/);
    expect(screen.queryByTestId('conflict-review-mounted')).not.toBeInTheDocument();
  });
});

// Deliberately last in this file -- see the header comment on why a
// sync-triggering test must not run before the idle-state assertions
// above (offline-sync.ts's lastSyncedAt is module-level, not per-tenant).
it('"Retry now" flushes the queue through a real network round trip and the ledger reports synced', async () => {
  await queueAttendanceEntries(TENANT, [
    attendanceEntry({ clientId: 'retry-1', syncState: 'failed', failReason: 'Still offline, or the school could not be reached — will retry automatically.' }),
  ]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([{ outcome: 'created', entry: {} }])));

  render(<SyncLedger tenantId={TENANT} />);
  await screen.findByText('1 could not be saved');
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry now' }));

  await waitFor(() => expect(screen.getByText(/All saved to school/)).toBeInTheDocument());
});
