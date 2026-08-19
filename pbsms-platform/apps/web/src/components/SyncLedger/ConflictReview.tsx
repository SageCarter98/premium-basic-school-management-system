'use client';

import { useEffect, useState } from 'react';
import { apiFetch, apiGet } from '@/lib/api-client';
import styles from './SyncLedger.module.css';

interface AttendanceConflict {
  id: string;
  attendance_record_id: string;
  incoming_status: string;
  incoming_device_timestamp: string;
  incoming_submitted_by: string | null;
  resolved_at: string | null;
}

interface AttendanceRecord {
  id: string;
  status: string;
  device_timestamp: string;
  created_by: string | null;
}

interface ConflictWithExisting extends AttendanceConflict {
  existing: AttendanceRecord | null;
}

/**
 * FR-ATT-011's "surfaced for manual reconciliation, never auto-resolved"
 * (spec §8.2/§9.1) — ACADEMIC_ADMIN-only, reachable from SyncLedger's
 * detail panel when a queued entry's failure is a real conflict, not a
 * plain rejection. Shows both values, both authors, both times per the
 * spec's own wording; a reviewer picks a side, nothing is ever merged.
 */
export function ConflictReview({ onResolved }: { onResolved: () => void }) {
  const [conflicts, setConflicts] = useState<ConflictWithExisting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const rows = await apiGet<AttendanceConflict[]>('/v1/attendance/conflicts');
      const withExisting = await Promise.all(
        rows.map(async (c) => {
          try {
            const existing = await apiGet<AttendanceRecord>(`/v1/attendance/${c.attendance_record_id}`);
            return { ...c, existing };
          } catch {
            return { ...c, existing: null };
          }
        }),
      );
      if (!cancelled) {
        setConflicts(withExisting);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function resolve(id: string, resolution: 'kept_existing' | 'applied_incoming') {
    await apiFetch(`/v1/attendance/conflicts/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    });
    setConflicts((prev) => prev.filter((c) => c.id !== id));
    onResolved();
  }

  if (loading) return null;
  if (conflicts.length === 0) return null;

  return (
    <ul className={styles.conflictList}>
      {conflicts.map((c) => (
        <li key={c.id} className={styles.conflictItem}>
          <strong>Conflicting attendance mark</strong>
          <div className={styles.conflictSides}>
            <div className={styles.conflictSide}>
              <div>Currently recorded</div>
              <div>{c.existing?.status ?? 'unknown'}</div>
              <div>
                {c.existing?.created_by ?? 'unknown teacher'} —{' '}
                {c.existing ? new Date(c.existing.device_timestamp).toLocaleString() : ''}
              </div>
            </div>
            <div className={styles.conflictSide}>
              <div>Incoming</div>
              <div>{c.incoming_status}</div>
              <div>
                {c.incoming_submitted_by ?? 'unknown teacher'} — {new Date(c.incoming_device_timestamp).toLocaleString()}
              </div>
            </div>
          </div>
          <div className={styles.conflictActions}>
            <button type="button" onClick={() => resolve(c.id, 'kept_existing')}>
              Keep current
            </button>
            <button type="button" onClick={() => resolve(c.id, 'applied_incoming')}>
              Apply incoming
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
