/**
 * offline-sync.ts
 *
 * Stage 3's orchestration layer (spec §9.1) — the piece that decides
 * whether a write goes straight to the network or into an IndexedDB
 * queue, and drives SyncLedger's state. When the device IS online, this
 * module still attempts the direct POST first (a plain fetch failure is
 * the only reliable "actually offline" signal in a browser —
 * `navigator.onLine` is a hint, not a guarantee) and only falls back to
 * the queue if that attempt fails — "Capture" (spec §9.1): writes always
 * go to IndexedDB first once queued, the UI never blocks on the network.
 *
 * Two independent queues live in this file, deliberately NOT sharing one
 * generic engine (see apps/web/README.md's Stage 4 section for why):
 * - Attendance (`submitAttendanceEntries`/`flushQueueNow`) — Stage 3.
 *   `/v1/attendance/sync` is a real batch, clientId-idempotent endpoint,
 *   so a whole submission is one request with per-entry outcomes.
 * - Scores (`submitScoreEntries`/`flushScoreQueueNow`) — Stage 4.
 *   `/v1/assessment/components/:id/scores` has no batch or idempotency-key
 *   support (NFR-PERF-030's optimistic locking is per-score, one request
 *   each), a deliberate frontend-only design confirmed with the user
 *   rather than adding a new backend sync endpoint: `clientId` here is
 *   purely this app's own queue/SyncLedger bookkeeping key, the server
 *   never sees it. A version conflict (409) surfaces using the backend's
 *   own message, which already names the other editor and says "reload
 *   and re-apply" — no bespoke conflict-reconciliation UI needed.
 */

import { apiFetch } from './api-client';
import {
  PendingAttendanceEntry,
  PendingScoreEntry,
  discardScoreEntry as discardScoreEntryFromDb,
  getQueuedAttendanceEntries,
  getQueuedScoreEntries,
  pruneSentEntries,
  pruneSentScoreEntries,
  queueAttendanceEntries,
  queueScoreEntries,
  updateQueuedEntryState,
  updateQueuedScoreEntryState,
} from './offline-db';

export interface AttendanceMark {
  studentId: string;
  classId: string;
  attendanceDate: string;
  session?: string;
  status: string;
}

export interface SyncLedgerState {
  status: 'idle' | 'offline-queued' | 'sending' | 'synced' | 'failed';
  pendingCount: number;
  sendingCount: number;
  failedCount: number;
  lastSyncedAt: string | null;
}

type SyncEntryOutcome =
  | { outcome: 'created' | 'updated' | 'idempotent_replay' | 'superseded'; entry: unknown }
  | { outcome: 'conflict'; entry: unknown; conflictId: string }
  | { outcome: 'forbidden'; entry: unknown; reason: string };

let lastSyncedAt: string | null = null;
const listeners = new Set<(state: SyncLedgerState) => void>();

function newClientId(): string {
  // crypto.randomUUID() needs a secure context (https or localhost) — the
  // same constraint spec §9.2 already documents for service worker
  // registration, so nothing new is assumed here.
  return crypto.randomUUID();
}

async function computeState(tenantId: string): Promise<SyncLedgerState> {
  const entries = await getQueuedAttendanceEntries(tenantId);
  const pendingCount = entries.filter((e) => e.syncState === 'pending').length;
  const sendingCount = entries.filter((e) => e.syncState === 'sending').length;
  const failedCount = entries.filter((e) => e.syncState === 'failed').length;
  let status: SyncLedgerState['status'] = 'idle';
  if (sendingCount > 0) status = 'sending';
  else if (failedCount > 0) status = 'failed';
  else if (pendingCount > 0) status = 'offline-queued';
  else if (lastSyncedAt) status = 'synced';
  return { status, pendingCount, sendingCount, failedCount, lastSyncedAt };
}

async function notify(tenantId: string): Promise<void> {
  const state = await computeState(tenantId);
  listeners.forEach((cb) => cb(state));
}

/**
 * Subscribes to SyncLedger state changes for one tenant. Fires immediately
 * with the current state, then again on: a local queue mutation in this
 * tab, the browser's online event (triggers an automatic flush attempt),
 * and a 'pbsms-sync-update' message from the service worker (a background
 * sync completed while this tab may not have been driving it). Returns an
 * unsubscribe function.
 */
export function subscribeSyncState(tenantId: string, cb: (state: SyncLedgerState) => void): () => void {
  listeners.add(cb);
  computeState(tenantId).then(cb);

  const onOnline = () => {
    flushQueueNow(tenantId).catch(() => {
      // flushQueueNow already records failures per-entry; nothing more to do here
    });
  };
  const onSwMessage = (event: MessageEvent) => {
    if (event.data?.type === 'pbsms-sync-update' && event.data?.tenantId === tenantId) {
      if (event.data.lastSyncedAt) lastSyncedAt = event.data.lastSyncedAt;
      notify(tenantId);
    }
  };

  window.addEventListener('online', onOnline);
  navigator.serviceWorker?.addEventListener?.('message', onSwMessage);

  return () => {
    listeners.delete(cb);
    window.removeEventListener('online', onOnline);
    navigator.serviceWorker?.removeEventListener?.('message', onSwMessage);
  };
}

async function registerBackgroundSync(tag: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    // SyncManager is not in TypeScript's lib.dom types yet in every
    // toolchain version — narrow through `unknown` rather than `any`.
    const syncRegistration = registration as unknown as { sync?: { register(tag: string): Promise<void> } };
    await syncRegistration.sync?.register(tag);
  } catch {
    // Background Sync isn't available in every browser (notably Safari) —
    // the 'online' listener in subscribeSyncState()/subscribeScoreSyncState()
    // is the fallback path, not this one silently failing.
  }
}

function toPendingEntry(mark: AttendanceMark): PendingAttendanceEntry {
  return {
    clientId: newClientId(),
    studentId: mark.studentId,
    classId: mark.classId,
    attendanceDate: mark.attendanceDate,
    session: mark.session,
    status: mark.status,
    deviceTimestamp: new Date().toISOString(),
    syncState: 'pending',
    queuedAt: new Date().toISOString(),
  };
}

async function postBatch(entries: PendingAttendanceEntry[]): Promise<SyncEntryOutcome[]> {
  const res = await apiFetch('/v1/attendance/sync', {
    method: 'POST',
    body: JSON.stringify({
      entries: entries.map((e) => ({
        clientId: e.clientId,
        studentId: e.studentId,
        classId: e.classId,
        attendanceDate: e.attendanceDate,
        session: e.session,
        status: e.status,
        deviceTimestamp: e.deviceTimestamp,
      })),
    }),
  });
  if (!res.ok) throw new Error(`sync failed: ${res.status}`);
  return (await res.json()) as SyncEntryOutcome[];
}

/**
 * The one entry point the register screen calls on "Submit register".
 * Tries the network first; on any failure (offline, timeout, 5xx) falls
 * back to queuing every mark for background sync — this is the "queues,
 * never blocks" half of spec §8.1's "'Submit register' works offline."
 */
export async function submitAttendanceEntries(tenantId: string, marks: AttendanceMark[]): Promise<void> {
  if (marks.length === 0) return;
  const pending = marks.map(toPendingEntry);

  try {
    const outcomes = await postBatch(pending);
    applyOutcomes(pending, outcomes);
    const stillQueued = pending.filter((e) => e.syncState !== 'sent');
    if (stillQueued.length > 0) {
      await queueAttendanceEntries(tenantId, stillQueued);
    }
    lastSyncedAt = new Date().toISOString();
  } catch {
    // Network-level failure (offline, DNS, timeout) — never a rejected
    // outcome from the server, those are handled inside applyOutcomes
    // above. Queue everything as pending for background sync.
    await queueAttendanceEntries(tenantId, pending);
    await registerBackgroundSync('sync-attendance');
  }
  await notify(tenantId);
}

function applyOutcomes(entries: PendingAttendanceEntry[], outcomes: SyncEntryOutcome[]): void {
  outcomes.forEach((outcome, i) => {
    const entry = entries[i];
    if (!entry) return;
    if (outcome.outcome === 'conflict') {
      entry.syncState = 'failed';
      entry.conflictId = outcome.conflictId;
      entry.failReason = 'A different teacher already recorded a different status for this student — needs review.';
    } else if (outcome.outcome === 'forbidden') {
      entry.syncState = 'failed';
      entry.failReason = outcome.reason;
    } else {
      entry.syncState = 'sent';
    }
  });
}

/**
 * Manual retry (SyncLedger's "View" → retry action) and the automatic
 * retry fired on the browser's 'online' event. Re-attempts every entry
 * that isn't already 'sent' — including previously 'failed' ones, since a
 * forbidden/conflict outcome from a stale queue entry is exactly the kind
 * of thing a reviewer might have already fixed server-side (e.g. a
 * conflict getting resolved, or a teacher assignment being corrected).
 */
export async function flushQueueNow(tenantId: string): Promise<void> {
  const all = await getQueuedAttendanceEntries(tenantId);
  const toSend = all.filter((e) => e.syncState !== 'sent' && e.syncState !== 'sending');
  if (toSend.length === 0) return;

  for (const entry of toSend) {
    await updateQueuedEntryState(tenantId, entry.clientId, { syncState: 'sending' });
  }
  await notify(tenantId);

  try {
    const outcomes = await postBatch(toSend);
    for (let i = 0; i < toSend.length; i++) {
      const outcome = outcomes[i];
      if (!outcome) continue;
      if (outcome.outcome === 'conflict') {
        await updateQueuedEntryState(tenantId, toSend[i].clientId, {
          syncState: 'failed',
          conflictId: outcome.conflictId,
          failReason: 'A different teacher already recorded a different status for this student — needs review.',
        });
      } else if (outcome.outcome === 'forbidden') {
        await updateQueuedEntryState(tenantId, toSend[i].clientId, {
          syncState: 'failed',
          failReason: outcome.reason,
        });
      } else {
        await updateQueuedEntryState(tenantId, toSend[i].clientId, { syncState: 'sent' });
      }
    }
    lastSyncedAt = new Date().toISOString();
    await pruneSentEntries(tenantId);
  } catch {
    for (const entry of toSend) {
      await updateQueuedEntryState(tenantId, entry.clientId, {
        syncState: 'failed',
        failReason: 'Still offline, or the school could not be reached — will retry automatically.',
      });
    }
  }
  await notify(tenantId);
}

// ---------------------------------------------------------------------
// Scores (Stage 4, spec §8.11) — see file header for why this is a
// separate, non-batched queue rather than sharing attendance's shape.
// ---------------------------------------------------------------------

export interface ScoreMark {
  componentId: string;
  studentId: string;
  status: 'scored' | 'missing';
  value?: number;
  missingReason?: string;
  expectedVersion?: number;
}

let scoreLastSyncedAt: string | null = null;
const scoreListeners = new Set<(state: SyncLedgerState) => void>();

async function computeScoreState(tenantId: string): Promise<SyncLedgerState> {
  const entries = await getQueuedScoreEntries(tenantId);
  const pendingCount = entries.filter((e) => e.syncState === 'pending').length;
  const sendingCount = entries.filter((e) => e.syncState === 'sending').length;
  const failedCount = entries.filter((e) => e.syncState === 'failed').length;
  let status: SyncLedgerState['status'] = 'idle';
  if (sendingCount > 0) status = 'sending';
  else if (failedCount > 0) status = 'failed';
  else if (pendingCount > 0) status = 'offline-queued';
  else if (scoreLastSyncedAt) status = 'synced';
  return { status, pendingCount, sendingCount, failedCount, lastSyncedAt: scoreLastSyncedAt };
}

async function notifyScore(tenantId: string): Promise<void> {
  const state = await computeScoreState(tenantId);
  scoreListeners.forEach((cb) => cb(state));
}

/** Score-queue equivalent of subscribeSyncState() — see that function's
 * doc comment, identical shape, separate listener set and SW message type
 * ('pbsms-score-sync-update' vs 'pbsms-sync-update') so the two queues
 * never cross-notify each other's subscribers. */
export function subscribeScoreSyncState(tenantId: string, cb: (state: SyncLedgerState) => void): () => void {
  scoreListeners.add(cb);
  computeScoreState(tenantId).then(cb);

  const onOnline = () => {
    flushScoreQueueNow(tenantId).catch(() => {
      // flushScoreQueueNow already records failures per-entry
    });
  };
  const onSwMessage = (event: MessageEvent) => {
    if (event.data?.type === 'pbsms-score-sync-update' && event.data?.tenantId === tenantId) {
      if (event.data.lastSyncedAt) scoreLastSyncedAt = event.data.lastSyncedAt;
      notifyScore(tenantId);
    }
  };

  window.addEventListener('online', onOnline);
  navigator.serviceWorker?.addEventListener?.('message', onSwMessage);

  return () => {
    scoreListeners.delete(cb);
    window.removeEventListener('online', onOnline);
    navigator.serviceWorker?.removeEventListener?.('message', onSwMessage);
  };
}

function toPendingScoreEntry(mark: ScoreMark): PendingScoreEntry {
  return {
    clientId: newClientId(),
    componentId: mark.componentId,
    studentId: mark.studentId,
    status: mark.status,
    value: mark.value,
    missingReason: mark.missingReason,
    expectedVersion: mark.expectedVersion,
    syncState: 'pending',
    queuedAt: new Date().toISOString(),
  };
}

/** One request per entry — the endpoint has no batch form. Returns a
 * definitive server verdict (ok, or a human-readable rejection reason for
 * a 403/404/409) rather than throwing for those; only a genuine network
 * failure (offline, timeout, 5xx) throws, so callers can tell "the server
 * said no" apart from "never reached the server" the same way
 * postBatch()'s outcome array does for attendance. */
async function postScore(entry: PendingScoreEntry): Promise<{ ok: true } | { ok: false; failReason: string }> {
  const res = await apiFetch(`/v1/assessment/components/${entry.componentId}/scores`, {
    method: 'POST',
    body: JSON.stringify({
      studentId: entry.studentId,
      status: entry.status,
      value: entry.value,
      missingReason: entry.missingReason,
      expectedVersion: entry.expectedVersion,
    }),
  });
  if (res.ok) return { ok: true };
  if (res.status === 409 || res.status === 403 || res.status === 404) {
    const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = body?.message;
    const failReason = Array.isArray(message) ? message.join('; ') : (message ?? `Could not be saved (${res.status})`);
    return { ok: false, failReason };
  }
  throw new Error(`score post failed: ${res.status}`);
}

/**
 * The entry point the score screen calls on "Submit". Each mark is posted
 * individually and immediately, online-first; only marks that hit a
 * genuine network failure get queued for background sync — a definitive
 * 403/404/409 is recorded as 'failed' right away (queued too, so it's
 * visible in SyncLedger's detail and can be retried), it is never silently
 * dropped or retried against the same stale expectedVersion forever.
 */
export async function submitScoreEntries(tenantId: string, marks: ScoreMark[]): Promise<void> {
  if (marks.length === 0) return;
  const toQueue: PendingScoreEntry[] = [];
  let anySent = false;

  for (const mark of marks) {
    const entry = toPendingScoreEntry(mark);
    try {
      const result = await postScore(entry);
      if (result.ok) {
        anySent = true;
      } else {
        entry.syncState = 'failed';
        entry.failReason = result.failReason;
        toQueue.push(entry);
      }
    } catch {
      toQueue.push(entry); // stays 'pending' — genuine network failure
    }
  }

  if (toQueue.length > 0) {
    await queueScoreEntries(tenantId, toQueue);
    if (toQueue.some((e) => e.syncState === 'pending')) {
      await registerBackgroundSync('sync-scores');
    }
  }
  if (anySent) scoreLastSyncedAt = new Date().toISOString();
  await notifyScore(tenantId);
}

/**
 * Manual retry / automatic retry on 'online'. Re-attempts every non-sent
 * entry including 'failed' ones — for a genuine network failure this is
 * exactly what fixes it (same as attendance). **Honest limitation, unlike
 * attendance**: a 'failed' entry from a real 409 version conflict will
 * fail the SAME way every retry, forever, because it resends the exact
 * `expectedVersion` that was already stale — retrying doesn't refresh it.
 * The real fix for a conflicted score is `discardScoreEntry()` (removes
 * the stale queue entry) followed by re-entering the value fresh on the
 * score screen, which re-reads the current version first. SyncLedger's
 * score-variant detail panel offers Discard specifically for this reason,
 * not just Retry.
 */
export async function flushScoreQueueNow(tenantId: string): Promise<void> {
  const all = await getQueuedScoreEntries(tenantId);
  const toSend = all.filter((e) => e.syncState !== 'sent' && e.syncState !== 'sending');
  if (toSend.length === 0) return;

  for (const entry of toSend) {
    await updateQueuedScoreEntryState(tenantId, entry.clientId, { syncState: 'sending' });
  }
  await notifyScore(tenantId);

  for (const entry of toSend) {
    try {
      const result = await postScore(entry);
      if (result.ok) {
        await updateQueuedScoreEntryState(tenantId, entry.clientId, { syncState: 'sent' });
        scoreLastSyncedAt = new Date().toISOString();
      } else {
        await updateQueuedScoreEntryState(tenantId, entry.clientId, {
          syncState: 'failed',
          failReason: result.failReason,
        });
      }
    } catch {
      await updateQueuedScoreEntryState(tenantId, entry.clientId, {
        syncState: 'failed',
        failReason: 'Still offline, or the school could not be reached — will retry automatically.',
      });
    }
  }
  await pruneSentScoreEntries(tenantId);
  await notifyScore(tenantId);
}

/** SyncLedger's score-variant "Discard" action — see flushScoreQueueNow's
 * doc comment for why a genuine 409 conflict needs this instead of retry. */
export async function discardScoreEntry(tenantId: string, clientId: string): Promise<void> {
  await discardScoreEntryFromDb(tenantId, clientId);
  await notifyScore(tenantId);
}
