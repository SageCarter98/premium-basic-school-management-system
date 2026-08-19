'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { OfflineState } from '@/components/states/OfflineState';
import { PendingAttendanceEntry, PendingScoreEntry, getQueuedAttendanceEntries, getQueuedScoreEntries } from '@/lib/offline-db';
import {
  SyncLedgerState,
  discardScoreEntry,
  flushQueueNow,
  flushScoreQueueNow,
  subscribeScoreSyncState,
  subscribeSyncState,
} from '@/lib/offline-sync';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { hasAnyRole } from '@/lib/role-groups';
import { ACADEMIC_ADMIN } from '@/lib/role-groups';
import { ConflictReview } from './ConflictReview';
import styles from './SyncLedger.module.css';

type QueueEntry = PendingAttendanceEntry | PendingScoreEntry;

const NOUN = { attendance: 'mark', score: 'score' } as const;

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

/**
 * Sending is reported as a single count, not the spec mockup's granular
 * "4 of 12 saved" — both queues post one request per flush call (a real
 * batch for attendance, a loop of individual requests for scores — see
 * offline-sync.ts's file header) rather than streaming per-entry progress
 * the UI could show mid-flight. Documented simplification, not a missed
 * requirement: the honesty rule (never claim a value you don't have) wins
 * over matching the mockup's exact wording.
 */
function describeState(state: SyncLedgerState, variant: 'attendance' | 'score'): { message: string; actionLabel?: string } {
  const noun = NOUN[variant];
  switch (state.status) {
    case 'sending':
      return { message: `Sending ${state.sendingCount} ${noun}${state.sendingCount === 1 ? '' : 's'} to school…`, actionLabel: 'View' };
    case 'offline-queued':
      return {
        message: `Working offline — ${state.pendingCount} ${noun}${state.pendingCount === 1 ? '' : 's'} on this phone`,
        actionLabel: 'View',
      };
    case 'failed':
      return { message: `${state.failedCount} could not be saved`, actionLabel: 'Review' };
    case 'synced':
      return {
        message: `All saved to school${state.lastSyncedAt ? ` — ${relativeTime(state.lastSyncedAt)}` : ''}`,
        actionLabel: 'View',
      };
    default:
      return { message: '' };
  }
}

function entryLabel(entry: QueueEntry, variant: 'attendance' | 'score'): string {
  const studentTag = `${entry.studentId.slice(0, 8)}…`;
  if (variant === 'attendance') return `${studentTag} — ${(entry as PendingAttendanceEntry).status}`;
  const score = entry as PendingScoreEntry;
  return score.status === 'missing' ? `${studentTag} — missing (${score.missingReason ?? 'no reason'})` : `${studentTag} — ${score.value ?? '?'}`;
}

function entryStatusText(entry: QueueEntry): string {
  if (entry.syncState === 'pending') return 'on this phone';
  if (entry.syncState === 'sending') return 'sending…';
  if (entry.syncState === 'failed') return entry.failReason ?? 'could not be saved';
  return 'saved to school';
}

/**
 * Spec §8.2 — always visible on offline-capable screens. Renders nothing
 * only in the true "never touched" state (no queue history, nothing ever
 * synced this session): before a teacher has submitted anything, there is
 * no honest sentence for the ledger to show yet. `variant` picks which of
 * the two independent queues (offline-sync.ts) this instance watches —
 * attendance (Stage 3, with ConflictReview for a real conflict row) or
 * scores (Stage 4, with a Discard action instead — see
 * offline-sync.ts's flushScoreQueueNow doc comment for why retry alone
 * isn't enough for a stale version conflict).
 */
export function SyncLedger({ tenantId, variant = 'attendance' }: { tenantId: string; variant?: 'attendance' | 'score' }) {
  const [state, setState] = useState<SyncLedgerState>({
    status: 'idle',
    pendingCount: 0,
    sendingCount: 0,
    failedCount: 0,
    lastSyncedAt: null,
  });
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canReviewConflicts = hasAnyRole(roleCodes, ACADEMIC_ADMIN);

  useEffect(
    () => (variant === 'attendance' ? subscribeSyncState(tenantId, setState) : subscribeScoreSyncState(tenantId, setState)),
    [tenantId, variant],
  );

  useEffect(() => {
    if (!expanded) return;
    const load = variant === 'attendance' ? getQueuedAttendanceEntries(tenantId) : getQueuedScoreEntries(tenantId);
    load.then(setEntries);
  }, [expanded, state, tenantId, variant]);

  if (state.status === 'idle') return null;

  const { message, actionLabel } = describeState(state, variant);
  const hasFailedConflicts = variant === 'attendance' && entries.some((e) => e.syncState === 'failed' && 'conflictId' in e && e.conflictId);

  function retry() {
    if (variant === 'attendance') flushQueueNow(tenantId);
    else flushScoreQueueNow(tenantId);
  }

  return (
    <div>
      <OfflineState message={message} actionLabel={actionLabel} onAction={() => setExpanded((v) => !v)} />
      {expanded && (
        <Card className={styles.detail}>
          <ul className={styles.entryList}>
            {entries.map((entry) => (
              <li key={entry.clientId} className={styles.entryRow}>
                <span>{entryLabel(entry, variant)}</span>
                <span className={styles.entryTrailing}>
                  <span className={entry.syncState === 'failed' ? styles.entryStatusFailed : styles.entryStatus}>
                    {entryStatusText(entry)}
                  </span>
                  {variant === 'score' && entry.syncState === 'failed' && (
                    <button type="button" onClick={() => discardScoreEntry(tenantId, entry.clientId)}>
                      Discard
                    </button>
                  )}
                </span>
              </li>
            ))}
            {entries.length === 0 && <li className={styles.entryStatus}>Nothing queued right now.</li>}
          </ul>
          <div className={styles.retryRow}>
            <button type="button" onClick={retry}>
              Retry now
            </button>
          </div>
          {hasFailedConflicts && canReviewConflicts && <ConflictReview onResolved={() => flushQueueNow(tenantId)} />}
          {hasFailedConflicts && !canReviewConflicts && (
            <p className={styles.entryStatusFailed}>
              A conflicting entry needs review by your academic office before it can be saved.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
