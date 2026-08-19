'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { SyncLedger } from '@/components/SyncLedger/SyncLedger';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { recordRegisterSubmission } from '@/lib/sw-register';
import { submitAttendanceEntries } from '@/lib/offline-sync';
import { getQueuedAttendanceEntries, PendingAttendanceEntry } from '@/lib/offline-db';
import {
  ClassOption,
  RosterData,
  RosterStudent,
  activeClassOptions,
  loadRosterData,
  rosterForClass,
} from '@/lib/attendance-roster';
import styles from './register.module.css';

const STATUS_OPTIONS: { code: string; label: string }[] = [
  { code: 'present', label: 'P' },
  { code: 'absent', label: 'A' },
  { code: 'late', label: 'L' },
  { code: 'excused', label: 'E' },
  { code: 'sick', label: 'S' },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Spec §8.1's signature screen, inside the real Teacher Field App shell
 * (Stage 4) — this is the same offline machinery Stage 3 proved out at
 * `/attendance`, promoted here with the two pieces of §8.1 polish that
 * were deliberately deferred then: sticky search (for large classes) and
 * a roster already ordered by surname (`rosterForClass()` already sorted
 * this way, unchanged). "Mark all ▾" stays a single "Mark all present"
 * action, not a full status menu — the spec shows a caret without
 * detailing other bulk options, and present-by-default is the one bulk
 * action real register-taking actually uses.
 */
export default function TeacherRegisterPage() {
  const token = decodeAccessToken();
  const tenantId = token?.tenantId ?? null;
  const teacherId = token?.sub ?? null;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterData | null>(null);
  const [selectedOption, setSelectedOption] = useState<ClassOption | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set());
  const [queueByStudent, setQueueByStudent] = useState<Map<string, PendingAttendanceEntry>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');

  const date = todayIso();

  useEffect(() => {
    if (!tenantId || !teacherId) return;
    let cancelled = false;
    loadRosterData(tenantId, teacherId)
      .then((data) => {
        if (cancelled) return;
        setRoster(data);
        const options = activeClassOptions(data);
        setSelectedOption(options[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your classes — no cached copy on this device either.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, teacherId]);

  // After a submit, reflect each student's ACTUAL queue state (not just
  // "I clicked submit") — spec §8.1's "the button never lies" applies
  // per-row too, not just to the SyncLedger banner.
  useEffect(() => {
    if (!tenantId || submittedIds.size === 0) return;
    let cancelled = false;
    const refresh = () => {
      getQueuedAttendanceEntries(tenantId).then((entries) => {
        if (cancelled) return;
        const byStudent = new Map<string, PendingAttendanceEntry>();
        entries.forEach((e) => {
          if (e.attendanceDate === date) byStudent.set(e.studentId, e);
        });
        setQueueByStudent(byStudent);
      });
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tenantId, submittedIds, date]);

  const classOptions = useMemo(() => (roster ? activeClassOptions(roster) : []), [roster]);
  const rosterStudents: RosterStudent[] = useMemo(() => {
    if (!roster || !selectedOption) return [];
    return rosterForClass(roster, selectedOption.classId, selectedOption.academicYearId);
  }, [roster, selectedOption]);
  const visibleStudents = useMemo(() => {
    if (!search.trim()) return rosterStudents;
    const q = search.trim().toLowerCase();
    return rosterStudents.filter((s) => s.name.toLowerCase().includes(q));
  }, [rosterStudents, search]);

  function setMark(studentId: string, status: string) {
    setMarks((prev) => ({ ...prev, [studentId]: status }));
  }

  function markAllPresent() {
    const next: Record<string, string> = { ...marks };
    rosterStudents.forEach((s) => {
      if (!next[s.studentId]) next[s.studentId] = 'present';
    });
    setMarks(next);
  }

  async function handleSubmit() {
    if (!tenantId || !selectedOption) return;
    const toSubmit = rosterStudents.filter((s) => marks[s.studentId]);
    if (toSubmit.length === 0) return;
    setSubmitting(true);
    try {
      await submitAttendanceEntries(
        tenantId,
        toSubmit.map((s) => ({
          studentId: s.studentId,
          classId: selectedOption.classId,
          attendanceDate: date,
          status: marks[s.studentId],
        })),
      );
      setSubmittedIds((prev) => {
        const next = new Set(prev);
        toSubmit.forEach((s) => next.add(s.studentId));
        return next;
      });
      recordRegisterSubmission();
    } finally {
      setSubmitting(false);
    }
  }

  function syncCaption(studentId: string): string | null {
    if (!submittedIds.has(studentId)) {
      return marks[studentId] ? 'marked — tap Submit register' : null;
    }
    const queued = queueByStudent.get(studentId);
    if (!queued) return 'saved to school';
    if (queued.syncState === 'failed') return queued.failReason ?? 'could not be saved';
    return 'on this phone';
  }

  if (!tenantId || !teacherId) {
    return <ErrorState message="Sign in again to mark attendance." />;
  }

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading your classes" rows={5} />
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card>
        <ErrorState message={loadError} />
      </Card>
    );
  }

  if (classOptions.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No assigned classes"
          message="You don't have an active class assignment yet — ask your academic office to assign you to a class."
        />
      </Card>
    );
  }

  const markedCount = rosterStudents.filter((s) => marks[s.studentId]).length;

  return (
    <div>
      <SyncLedger tenantId={tenantId} variant="attendance" />
      <Card style={{ padding: 'var(--pb-space-4)', marginTop: 'var(--pb-space-3)' }}>
        <div className={styles.header}>
          <select
            className={styles.classSelect}
            value={selectedOption ? `${selectedOption.classId}:${selectedOption.academicYearId}` : ''}
            onChange={(e) => {
              const [classId, academicYearId] = e.target.value.split(':');
              setSelectedOption(classOptions.find((o) => o.classId === classId && o.academicYearId === academicYearId) ?? null);
              setMarks({});
              setSubmittedIds(new Set());
              setSearch('');
            }}
          >
            {classOptions.map((o) => (
              <option key={`${o.classId}:${o.academicYearId}`} value={`${o.classId}:${o.academicYearId}`}>
                {o.className}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={markAllPresent}>
            Mark all present
          </Button>
        </div>

        {rosterStudents.length > 8 && (
          <div className={styles.searchRow}>
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search students…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search students in this class"
            />
          </div>
        )}

        <p className={styles.summaryLine}>
          {date} — {markedCount} of {rosterStudents.length} marked
        </p>

        {rosterStudents.length === 0 ? (
          <EmptyState title="No students enrolled" message="This class has no active enrolments for this academic year yet." />
        ) : visibleStudents.length === 0 ? (
          <EmptyState title="No matches" message="No students match that search — clear it to see the full roster." />
        ) : (
          <div>
            {visibleStudents.map((student) => (
              <div key={student.studentId} className={styles.row}>
                <div className={styles.studentInfo}>
                  <span className={styles.studentName}>{student.name}</span>
                  {syncCaption(student.studentId) && (
                    <span className={styles.syncCaption}>{syncCaption(student.studentId)}</span>
                  )}
                </div>
                <div className={styles.segmented} role="group" aria-label={`Attendance status for ${student.name}`}>
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.code}
                      type="button"
                      className={[styles.segmentBtn, marks[student.studentId] === opt.code ? styles.segmentBtnActive : '']
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={marks[student.studentId] === opt.code}
                      onClick={() => setMark(student.studentId, opt.code)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className={styles.footer}>
          <span className={styles.summaryLine}>{markedCount} of {rosterStudents.length} marked</span>
          <Button type="button" onClick={handleSubmit} disabled={submitting || markedCount === 0}>
            {typeof navigator !== 'undefined' && !navigator.onLine ? 'Submit when back online' : 'Submit register'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
