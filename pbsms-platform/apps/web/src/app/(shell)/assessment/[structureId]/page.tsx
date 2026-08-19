'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { apiFetch, apiGet } from '@/lib/api-client';
import { AssessmentComponent, AssessmentStructure, Subject, componentTypeLabel } from '@/lib/assessment-roster';
import styles from './grid.module.css';

interface SchoolClass {
  id: string;
  name: string;
}

interface Enrolment {
  student_id: string;
  class_id: string;
  academic_year_id: string;
  status: string;
}

interface Student {
  id: string;
  first_name: string;
  last_name: string;
}

interface ScoreRow {
  assessment_component_id: string;
  student_id: string;
  value: string | null;
  status: string;
  missing_reason: string | null;
  version: number;
}

interface CellState {
  value: string;
  status: 'scored' | 'missing';
  missingReason?: string;
  version?: number;
  error?: string;
  saved?: boolean;
}

function cellKey(studentId: string, componentId: string): string {
  return `${studentId}:${componentId}`;
}

/**
 * Spec §8.3 "Score Entry Grid (Staff Console)" — the spreadsheet-grade
 * desktop counterpart to Stage 4's mobile stepper, both writing through
 * the SAME `/v1/assessment/components/:id/scores` endpoint (no new
 * backend surface). Rows = roster students, columns = the structure's
 * components — genuinely spreadsheet-shaped, unlike the Teacher Field
 * App's one-column-at-a-time stepper. Commit-on-blur, Enter moves focus
 * down the same column (Tab's native focus order already moves right
 * across a row, so no custom handling needed there). Not offline-capable
 * — spec §9.1 scopes offline explicitly to the Teacher Field App's
 * register/score screens, not this desktop grid.
 */
export default function ScoreEntryGridPage({ params }: { params: Promise<{ structureId: string }> }) {
  const { structureId } = use(params);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [structure, setStructure] = useState<AssessmentStructure | null>(null);
  const [components, setComponents] = useState<AssessmentComponent[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [cells, setCells] = useState<Map<string, CellState>>(new Map());
  const inputRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [st, comps, allEnrolments, allStudents, allClasses, allSubjects] = await Promise.all([
        apiGet<AssessmentStructure>(`/v1/assessment/structures/${structureId}`),
        apiGet<AssessmentComponent[]>(`/v1/assessment/structures/${structureId}/components`),
        apiGet<Enrolment[]>('/v1/enrolments'),
        apiGet<Student[]>('/v1/students'),
        apiGet<SchoolClass[]>('/v1/classes'),
        apiGet<Subject[]>('/v1/assessment/subjects'),
      ]);
      if (cancelled) return;
      setStructure(st);
      setComponents(comps);
      setClasses(allClasses);
      setSubjects(allSubjects);

      const rosterIds = new Set(
        allEnrolments.filter((e) => e.class_id === st.class_id && e.academic_year_id === st.academic_year_id && e.status === 'active').map((e) => e.student_id),
      );
      const roster = allStudents.filter((s) => rosterIds.has(s.id)).sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`));
      setStudents(roster);

      const allScores = await Promise.all(comps.map((c) => apiGet<ScoreRow[]>(`/v1/assessment/components/${c.id}/scores`)));
      if (cancelled) return;
      const next = new Map<string, CellState>();
      comps.forEach((c, i) => {
        allScores[i].forEach((row) => {
          next.set(cellKey(row.student_id, c.id), {
            value: row.status === 'scored' ? String(Number(row.value)) : '',
            status: row.status as 'scored' | 'missing',
            missingReason: row.missing_reason ?? undefined,
            version: row.version,
            saved: true,
          });
        });
      });
      setCells(next);
    }
    load()
      .catch(() => {
        if (!cancelled) setLoadError('Could not load this assessment structure.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [structureId]);

  const locked = structure?.status !== 'draft';

  function getCell(studentId: string, componentId: string): CellState {
    return cells.get(cellKey(studentId, componentId)) ?? { value: '', status: 'scored' };
  }

  function setCell(studentId: string, componentId: string, patch: Partial<CellState>) {
    setCells((prev) => {
      const next = new Map(prev);
      next.set(cellKey(studentId, componentId), { ...getCell(studentId, componentId), ...patch, saved: false });
      return next;
    });
  }

  async function commitCell(studentId: string, componentId: string, component: AssessmentComponent) {
    const cell = getCell(studentId, componentId);
    if (cell.status === 'scored') {
      if (cell.value.trim() === '') return; // nothing entered yet, nothing to commit
      const num = Number(cell.value);
      const maxScore = Number(component.max_score);
      if (Number.isNaN(num) || num < 0 || num > maxScore) {
        setCell(studentId, componentId, { error: `Enter a value between 0 and ${maxScore}` });
        return;
      }
    } else if (!cell.missingReason) {
      setCell(studentId, componentId, { error: 'State a reason for the missing score' });
      return;
    }

    const res = await apiFetch(`/v1/assessment/components/${componentId}/scores`, {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        status: cell.status,
        value: cell.status === 'scored' ? Number(cell.value) : undefined,
        missingReason: cell.status === 'missing' ? cell.missingReason : undefined,
        expectedVersion: cell.version,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setCell(studentId, componentId, { error: body?.message ?? `Could not save (${res.status})` });
      return;
    }
    const saved = (await res.json()) as ScoreRow;
    setCells((prev) => {
      const next = new Map(prev);
      next.set(cellKey(studentId, componentId), {
        value: saved.status === 'scored' ? String(Number(saved.value)) : '',
        status: saved.status as 'scored' | 'missing',
        missingReason: saved.missing_reason ?? undefined,
        version: saved.version,
        saved: true,
      });
      return next;
    });
  }

  function focusCell(rowIndex: number, colIndex: number) {
    const key = `${rowIndex}:${colIndex}`;
    inputRefs.current.get(key)?.focus();
  }

  const structureLabel = useMemo(() => {
    if (!structure) return '';
    const cls = classes.find((c) => c.id === structure.class_id)?.name ?? structure.class_id;
    const subj = subjects.find((s) => s.id === structure.subject_id)?.name ?? structure.subject_id;
    return `${subj} · ${cls}`;
  }, [structure, classes, subjects]);

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading score entry grid" rows={6} />
      </Card>
    );
  }

  if (loadError || !structure) {
    return (
      <Card>
        <ErrorState message={loadError ?? 'Structure not found.'} />
      </Card>
    );
  }

  return (
    <Card style={{ padding: 'var(--pb-space-4)' }}>
      <div className={styles.header}>
        <strong>{structureLabel} — Score Entry Grid</strong>
      </div>

      {locked && (
        <div className={styles.lockedBanner}>
          This structure is <strong>{structure.status}</strong> — scores are locked. Use "Request reopen" on the
          Assessment screen to make corrections.
        </div>
      )}

      {components.length === 0 ? (
        <EmptyState title="No components" message="Add a component on the Assessment screen before entering scores." />
      ) : students.length === 0 ? (
        <EmptyState title="No students enrolled" message="This class has no active enrolments for this academic year." />
      ) : (
        <div className={styles.wrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.studentCol}>Student</th>
                {components.map((c) => (
                  <th key={c.id}>
                    {componentTypeLabel(c.component_type)}
                    <div style={{ fontWeight: 400, color: 'var(--pb-ink-muted)' }}>out of {c.max_score}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((student, rowIndex) => (
                <tr key={student.id}>
                  <td className={styles.studentCol}>
                    {student.last_name}, {student.first_name}
                  </td>
                  {components.map((component, colIndex) => {
                    const cell = getCell(student.id, component.id);
                    const key = `${rowIndex}:${colIndex}`;
                    return (
                      <td key={component.id}>
                        <div className={styles.cell}>
                          {cell.status === 'missing' ? (
                            <input
                              className={styles.scoreInput}
                              style={{ width: 110, textAlign: 'left' }}
                              placeholder="Reason"
                              disabled={locked}
                              value={cell.missingReason ?? ''}
                              onChange={(e) => setCell(student.id, component.id, { missingReason: e.target.value, error: undefined })}
                              onBlur={() => commitCell(student.id, component.id, component)}
                            />
                          ) : (
                            <input
                              ref={(el) => {
                                if (el) inputRefs.current.set(key, el);
                              }}
                              className={[styles.scoreInput, cell.error ? styles.scoreInputError : ''].filter(Boolean).join(' ')}
                              type="number"
                              disabled={locked}
                              value={cell.value}
                              min={0}
                              max={Number(component.max_score)}
                              onChange={(e) => setCell(student.id, component.id, { value: e.target.value, error: undefined })}
                              onBlur={() => commitCell(student.id, component.id, component)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  (e.target as HTMLInputElement).blur();
                                  focusCell(rowIndex + 1, colIndex);
                                }
                              }}
                            />
                          )}
                          <button
                            type="button"
                            className={[styles.missingBtn, cell.status === 'missing' ? styles.missingBtnActive : ''].filter(Boolean).join(' ')}
                            disabled={locked}
                            onClick={() =>
                              setCell(student.id, component.id, {
                                status: cell.status === 'missing' ? 'scored' : 'missing',
                                error: undefined,
                              })
                            }
                            aria-label={`Mark ${student.first_name} ${student.last_name}'s ${componentTypeLabel(component.component_type)} as missing`}
                          >
                            M
                          </button>
                          {cell.saved && !cell.error && <span className={styles.savedTick}>✓</span>}
                        </div>
                        {cell.error && <span className={styles.cellError}>{cell.error}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
