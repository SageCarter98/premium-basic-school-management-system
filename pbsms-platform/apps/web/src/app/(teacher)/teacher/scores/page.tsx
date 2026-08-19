'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { SyncLedger } from '@/components/SyncLedger/SyncLedger';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { RosterData, RosterStudent, loadRosterData, rosterForClass } from '@/lib/attendance-roster';
import {
  AssessmentComponent,
  AssessmentStructure,
  Subject,
  componentTypeLabel,
  findOpenStructure,
  loadComponents,
  loadScores,
  loadStructures,
  loadSubjects,
  ScoreRow,
} from '@/lib/assessment-roster';
import { ScoreMark, submitScoreEntries } from '@/lib/offline-sync';
import { PendingScoreEntry, getQueuedScoreEntries } from '@/lib/offline-db';
import styles from './scores.module.css';

interface AssignmentOption {
  key: string;
  classId: string;
  subjectId: string;
  academicYearId: string;
  className: string;
  subjectName: string;
}

interface LocalMark {
  status: 'scored' | 'missing';
  value?: number;
  missingReason?: string;
}

/**
 * Spec §8.11 "Score Entry (Teacher Field App, offline)". One student per
 * screen SECTION (a scrollable list, not literal per-student pagination —
 * see the mockup, which shows two student cards stacked), a numeric
 * stepper as the primary input rather than the Staff Console's keyboard
 * grid (§8.3, Stage 5). Reuses the register's exact offline UX language
 * ("on this phone"/"saved to school") via the generalized SyncLedger, but
 * NOT its wire protocol — see offline-sync.ts's file header for why: this
 * endpoint has no batch/idempotency support, so each mark posts
 * individually and a genuine version conflict needs Discard, not just
 * Retry, to actually resolve.
 *
 * The "Grid" toggle (spec's compact all-students view) is explicitly
 * deferred — confirmed with the user before starting this stage — this
 * screen ships the stepper flow only.
 */
export default function TeacherScoresPage() {
  const token = decodeAccessToken();
  const tenantId = token?.tenantId ?? null;
  const teacherId = token?.sub ?? null;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterData | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [structures, setStructures] = useState<AssessmentStructure[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<AssignmentOption | null>(null);
  const [components, setComponents] = useState<AssessmentComponent[]>([]);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [existingScores, setExistingScores] = useState<Map<string, ScoreRow>>(new Map());
  const [marks, setMarks] = useState<Record<string, LocalMark>>({});
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set());
  const [queueByStudent, setQueueByStudent] = useState<Map<string, PendingScoreEntry>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!tenantId || !teacherId) return;
    let cancelled = false;
    Promise.all([loadRosterData(tenantId, teacherId), loadSubjects(tenantId), loadStructures(tenantId)])
      .then(([rosterData, subjectData, structureData]) => {
        if (cancelled) return;
        setRoster(rosterData);
        setSubjects(subjectData);
        setStructures(structureData);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your assessments — no cached copy on this device either.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, teacherId]);

  const assignmentOptions: AssignmentOption[] = useMemo(() => {
    if (!roster) return [];
    return roster.assignments
      .filter((a) => a.status === 'active')
      .map((a) => {
        const cls = roster.classes.find((c) => c.id === a.class_id);
        const subject = subjects.find((s) => s.id === a.subject_id);
        return {
          key: `${a.class_id}:${a.subject_id}:${a.academic_year_id}`,
          classId: a.class_id,
          subjectId: a.subject_id,
          academicYearId: a.academic_year_id,
          className: cls?.name ?? 'Class',
          subjectName: subject?.name ?? 'Subject',
        };
      });
  }, [roster, subjects]);

  useEffect(() => {
    if (selectedAssignment || assignmentOptions.length === 0) return;
    setSelectedAssignment(assignmentOptions[0]);
  }, [assignmentOptions, selectedAssignment]);

  const openStructure = useMemo(() => {
    if (!selectedAssignment) return null;
    return findOpenStructure(structures, selectedAssignment.classId, selectedAssignment.subjectId, selectedAssignment.academicYearId);
  }, [structures, selectedAssignment]);

  useEffect(() => {
    if (!tenantId || !openStructure) {
      setComponents([]);
      setSelectedComponentId(null);
      return;
    }
    let cancelled = false;
    loadComponents(tenantId, openStructure.id).then((rows) => {
      if (cancelled) return;
      setComponents(rows);
      setSelectedComponentId(rows[0]?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId, openStructure]);

  useEffect(() => {
    if (!tenantId || !selectedComponentId) {
      setExistingScores(new Map());
      return;
    }
    let cancelled = false;
    loadScores(tenantId, selectedComponentId).then((rows) => {
      if (cancelled) return;
      setExistingScores(new Map(rows.map((r) => [r.student_id, r])));
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId, selectedComponentId]);

  useEffect(() => {
    if (!tenantId || submittedIds.size === 0) return;
    let cancelled = false;
    const refresh = () => {
      getQueuedScoreEntries(tenantId).then((entries) => {
        if (cancelled) return;
        const byStudent = new Map<string, PendingScoreEntry>();
        entries
          .filter((e) => e.componentId === selectedComponentId)
          .forEach((e) => byStudent.set(e.studentId, e));
        setQueueByStudent(byStudent);
      });
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tenantId, submittedIds, selectedComponentId]);

  const rosterStudents: RosterStudent[] = useMemo(() => {
    if (!roster || !selectedAssignment) return [];
    return rosterForClass(roster, selectedAssignment.classId, selectedAssignment.academicYearId);
  }, [roster, selectedAssignment]);

  const selectedComponent = components.find((c) => c.id === selectedComponentId) ?? null;
  const maxScore = selectedComponent ? Number(selectedComponent.max_score) : 100;

  function markFor(studentId: string): LocalMark {
    if (marks[studentId]) return marks[studentId];
    const existing = existingScores.get(studentId);
    if (existing) {
      return existing.status === 'missing'
        ? { status: 'missing', missingReason: existing.missing_reason ?? '' }
        : { status: 'scored', value: existing.value !== null ? Number(existing.value) : 0 };
    }
    return { status: 'scored', value: 0 };
  }

  function updateMark(studentId: string, patch: Partial<LocalMark>) {
    setMarks((prev) => ({ ...prev, [studentId]: { ...markFor(studentId), ...patch } }));
  }

  function adjustValue(studentId: string, delta: number) {
    const current = markFor(studentId);
    const next = Math.max(0, Math.min(maxScore, (current.value ?? 0) + delta));
    updateMark(studentId, { status: 'scored', value: next });
  }

  async function handleSubmit() {
    if (!tenantId || !selectedComponentId) return;
    const changedStudentIds = Object.keys(marks);
    if (changedStudentIds.length === 0) return;
    setSubmitting(true);
    try {
      const toSubmit: ScoreMark[] = changedStudentIds.map((studentId) => {
        const mark = marks[studentId];
        const existing = existingScores.get(studentId);
        return {
          componentId: selectedComponentId,
          studentId,
          status: mark.status,
          value: mark.status === 'scored' ? mark.value : undefined,
          missingReason: mark.status === 'missing' ? mark.missingReason || 'Not stated' : undefined,
          expectedVersion: existing?.version,
        };
      });
      await submitScoreEntries(tenantId, toSubmit);
      setSubmittedIds((prev) => {
        const next = new Set(prev);
        changedStudentIds.forEach((id) => next.add(id));
        return next;
      });
    } finally {
      setSubmitting(false);
    }
  }

  function syncCaption(studentId: string): string | null {
    if (!submittedIds.has(studentId)) return marks[studentId] ? 'changed — tap Submit' : null;
    const queued = queueByStudent.get(studentId);
    if (!queued) return 'saved to school';
    if (queued.syncState === 'failed') return queued.failReason ?? 'could not be saved';
    return 'on this phone';
  }

  if (!tenantId || !teacherId) {
    return <ErrorState message="Sign in again to enter scores." />;
  }

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading your assessments" rows={5} />
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

  if (assignmentOptions.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No assigned classes"
          message="You don't have an active class assignment yet — ask your academic office to assign you to a class."
        />
      </Card>
    );
  }

  const scoredCount = rosterStudents.filter((s) => marks[s.studentId] || existingScores.has(s.studentId)).length;

  return (
    <div>
      <SyncLedger tenantId={tenantId} variant="score" />
      <Card style={{ padding: 'var(--pb-space-4)', marginTop: 'var(--pb-space-3)' }}>
        <div className={styles.header}>
          <select
            className={styles.select}
            value={selectedAssignment?.key ?? ''}
            onChange={(e) => {
              const next = assignmentOptions.find((o) => o.key === e.target.value) ?? null;
              setSelectedAssignment(next);
              setMarks({});
              setSubmittedIds(new Set());
            }}
          >
            {assignmentOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.subjectName} · {o.className}
              </option>
            ))}
          </select>

          {!openStructure && (
            <EmptyState
              title="Nothing open to score"
              message="There's no draft assessment for this class and subject yet — ask your academic office to create one, or it may already be published."
            />
          )}

          {openStructure && components.length > 1 && (
            <select
              className={styles.select}
              value={selectedComponentId ?? ''}
              onChange={(e) => {
                setSelectedComponentId(e.target.value);
                setMarks({});
                setSubmittedIds(new Set());
              }}
            >
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {componentTypeLabel(c.component_type)} (out of {c.max_score})
                </option>
              ))}
            </select>
          )}
        </div>

        {openStructure && selectedComponent && (
          <>
            <p className={styles.summaryLine}>
              {componentTypeLabel(selectedComponent.component_type)} — {scoredCount} of {rosterStudents.length} scored
            </p>

            {rosterStudents.length === 0 ? (
              <EmptyState title="No students enrolled" message="This class has no active enrolments for this academic year yet." />
            ) : (
              <div>
                {rosterStudents.map((student) => {
                  const mark = markFor(student.studentId);
                  return (
                    <div key={student.studentId} className={styles.row}>
                      <div>
                        <span className={styles.studentName}>{student.name}</span>
                        {syncCaption(student.studentId) && (
                          <div className={styles.syncCaption}>{syncCaption(student.studentId)}</div>
                        )}
                      </div>
                      {mark.status === 'missing' ? (
                        <div className={styles.stepperRow}>
                          <input
                            type="text"
                            className={styles.missingReasonInput}
                            placeholder="Reason (e.g. absent, exempt)"
                            value={mark.missingReason ?? ''}
                            onChange={(e) => updateMark(student.studentId, { missingReason: e.target.value })}
                          />
                          <button
                            type="button"
                            className={[styles.missingToggle, styles.missingToggleActive].join(' ')}
                            onClick={() => updateMark(student.studentId, { status: 'scored', value: mark.value ?? 0 })}
                          >
                            Missing
                          </button>
                        </div>
                      ) : (
                        <div className={styles.stepperRow}>
                          <button type="button" className={styles.stepperBtn} onClick={() => adjustValue(student.studentId, -1)}>
                            −
                          </button>
                          <input
                            type="number"
                            className={styles.stepperInput}
                            value={mark.value ?? 0}
                            min={0}
                            max={maxScore}
                            onChange={(e) => {
                              const n = Math.max(0, Math.min(maxScore, Number(e.target.value)));
                              updateMark(student.studentId, { status: 'scored', value: Number.isNaN(n) ? 0 : n });
                            }}
                          />
                          <button type="button" className={styles.stepperBtn} onClick={() => adjustValue(student.studentId, 1)}>
                            +
                          </button>
                          <span className={styles.outOf}>out of {maxScore}</span>
                          <button
                            type="button"
                            className={styles.missingToggle}
                            onClick={() => updateMark(student.studentId, { status: 'missing', missingReason: '' })}
                          >
                            Missing
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className={styles.footer}>
              <span className={styles.summaryLine}>
                {scoredCount} of {rosterStudents.length} scored
              </span>
              <Button type="button" onClick={handleSubmit} disabled={submitting || Object.keys(marks).length === 0}>
                {typeof navigator !== 'undefined' && !navigator.onLine ? 'Submit when back online' : 'Submit'}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
