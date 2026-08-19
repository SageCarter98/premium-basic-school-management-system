'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { apiFetch, apiGet } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { ACADEMIC_ADMIN, hasAnyRole } from '@/lib/role-groups';
import styles from './results.module.css';

interface StudentResult {
  id: string;
  student_id: string;
  class_id: string;
  academic_year_id: string;
  status: string;
  average_percentage: string | null;
  subjects_failed_count: number;
  overall_pass: boolean | null;
  superseded_at: string | null;
}

interface StudentResultItem {
  subject_id: string;
  subject_name: string;
  percentage: string;
  grade: string;
  is_pass: boolean;
}

interface Student {
  id: string;
  first_name: string;
  last_name: string;
}

interface SchoolClass {
  id: string;
  name: string;
  academic_year_id: string;
}

interface AcademicYear {
  id: string;
  name: string;
}

interface AssessmentStructure {
  id: string;
  class_id: string;
  academic_year_id: string;
  subject_id: string;
  status: string;
}

interface Subject {
  id: string;
  name: string;
}

interface Enrolment {
  student_id: string;
  class_id: string;
  academic_year_id: string;
  status: string;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  draft: 'neutral',
  submitted: 'warning',
  reviewed: 'warning',
  approved: 'warning',
  published: 'success',
  locked: 'success',
  archived: 'neutral',
  returned: 'danger',
  corrected: 'warning',
};

const TABS = ['Workflow queue', 'Publication gate'] as const;
type Tab = (typeof TABS)[number];

/** SRS Chapter 21 (spec §7.8's results workflow + §8.4 Publication Gate). */
export default function ResultsPage() {
  const [tab, setTab] = useState<Tab>('Workflow queue');
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([apiGet<Student[]>('/v1/students'), apiGet<SchoolClass[]>('/v1/classes'), apiGet<AcademicYear[]>('/v1/academic-years')]).then(([s, c, y]) => {
      setStudents(s);
      setClasses(c);
      setYears(y);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading results" rows={4} />
      </Card>
    );
  }

  return (
    <div>
      <div className={styles.tabBar} role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={[styles.tabBtn, tab === t ? styles.tabBtnActive : ''].filter(Boolean).join(' ')} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Workflow queue' ? <WorkflowQueue students={students} classes={classes} years={years} /> : <PublicationGate students={students} classes={classes} years={years} />}
    </div>
  );
}

function studentName(students: Student[], id: string): string {
  const s = students.find((st) => st.id === id);
  return s ? `${s.last_name}, ${s.first_name}` : id.slice(0, 8) + '…';
}

function WorkflowQueue({ students, classes, years }: { students: Student[]; classes: SchoolClass[]; years: AcademicYear[] }) {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const isAdmin = hasAnyRole(roleCodes, ACADEMIC_ADMIN);

  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<StudentResult[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState<StudentResultItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<StudentResult[]>('/v1/results')
      .then((all) => setResults(all.filter((r) => !r.superseded_at)))
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function toggleExpand(r: StudentResult) {
    if (expandedId === r.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(r.id);
    setItems(await apiGet<StudentResultItem[]>(`/v1/results/${r.id}/items`));
  }

  async function act(id: string, action: string, body?: unknown) {
    setError(null);
    const res = await apiFetch(`/v1/results/${id}/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      setError(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      return;
    }
    reload();
  }

  const visible = statusFilter ? results.filter((r) => r.status === statusFilter) : results;

  if (loading) return <LoadingState label="Loading the workflow queue" rows={5} />;

  return (
    <Card style={{ padding: 'var(--pb-space-4)' }}>
      <div className={styles.formRow}>
        <select className={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.keys(STATUS_VARIANT).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {error && <ErrorState message={error} />}
      {visible.length === 0 ? (
        <EmptyState title="No results here" message="Results appear once created from the Publication Gate tab." />
      ) : (
        visible.map((r) => (
          <div key={r.id}>
            <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => toggleExpand(r)}>
              <span>
                {studentName(students, r.student_id)} — {classes.find((c) => c.id === r.class_id)?.name ?? r.class_id} ·{' '}
                {years.find((y) => y.id === r.academic_year_id)?.name ?? r.academic_year_id}
              </span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                <Pill variant={STATUS_VARIANT[r.status] ?? 'neutral'}>{r.status}</Pill>
                {['draft', 'corrected'].includes(r.status) && (
                  <Button type="button" onClick={(e) => { e.stopPropagation(); act(r.id, 'submit'); }}>
                    Submit
                  </Button>
                )}
                {isAdmin && r.status === 'submitted' && (
                  <Button type="button" variant="secondary" onClick={(e) => { e.stopPropagation(); act(r.id, 'review'); }}>
                    Review
                  </Button>
                )}
                {isAdmin && ['submitted', 'reviewed'].includes(r.status) && (
                  <Button type="button" onClick={(e) => { e.stopPropagation(); act(r.id, 'approve'); }}>
                    Approve
                  </Button>
                )}
                {isAdmin && ['submitted', 'reviewed', 'approved'].includes(r.status) && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      const reason = window.prompt('Reason for returning this result:');
                      if (reason) act(r.id, 'return', { reason });
                    }}
                  >
                    Return
                  </Button>
                )}
                {r.status === 'returned' && (
                  <Button type="button" onClick={(e) => { e.stopPropagation(); act(r.id, 'correct'); }}>
                    Mark corrected
                  </Button>
                )}
                {isAdmin && r.status === 'approved' && (
                  <Button type="button" onClick={(e) => { e.stopPropagation(); act(r.id, 'publish'); }}>
                    Publish
                  </Button>
                )}
                {isAdmin && r.status === 'published' && (
                  <Button type="button" variant="secondary" onClick={(e) => { e.stopPropagation(); act(r.id, 'lock'); }}>
                    Lock
                  </Button>
                )}
                {isAdmin && r.status === 'locked' && (
                  <Button type="button" variant="secondary" onClick={(e) => { e.stopPropagation(); act(r.id, 'archive'); }}>
                    Archive
                  </Button>
                )}
                {isAdmin && ['published', 'locked'].includes(r.status) && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      const reason = window.prompt('Reason for reopening this result (required):');
                      if (reason) act(r.id, 'reopen', { reason });
                    }}
                  >
                    Reopen
                  </Button>
                )}
              </span>
            </div>
            {expandedId === r.id && (
              <div style={{ padding: 'var(--pb-space-2) var(--pb-space-4)', background: 'var(--pb-canvas)' }}>
                {items.length === 0 ? (
                  <EmptyState title="No graded subjects yet" message="Call resync once grading is complete for this class+year." />
                ) : (
                  items.map((it) => (
                    <div key={it.subject_id} className={styles.listRow}>
                      <span>{it.subject_name}</span>
                      <span>
                        {Number(it.percentage).toFixed(1)}% — <Pill variant={it.is_pass ? 'success' : 'danger'}>{it.grade}</Pill>
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))
      )}
    </Card>
  );
}

function PublicationGate({ students, classes, years }: { students: Student[]; classes: SchoolClass[]; years: AcademicYear[] }) {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const isAdmin = hasAnyRole(roleCodes, ACADEMIC_ADMIN);

  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [yearId, setYearId] = useState(classes[0]?.academic_year_id ?? years[0]?.id ?? '');
  const [loading, setLoading] = useState(true);
  const [structures, setStructures] = useState<AssessmentStructure[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [results, setResults] = useState<StudentResult[]>([]);
  const [itemsByResult, setItemsByResult] = useState<Map<string, StudentResultItem[]>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    if (!classId || !yearId) return;
    setLoading(true);
    Promise.all([
      apiGet<AssessmentStructure[]>('/v1/assessment/structures'),
      apiGet<Subject[]>('/v1/assessment/subjects'),
      apiGet<Enrolment[]>('/v1/enrolments'),
      apiGet<StudentResult[]>('/v1/results'),
    ]).then(async ([st, subj, enr, res]) => {
      const relevantStructures = st.filter((s) => s.class_id === classId && s.academic_year_id === yearId);
      const relevantResults = res.filter((r) => r.class_id === classId && r.academic_year_id === yearId && !r.superseded_at);
      setStructures(relevantStructures);
      setSubjects(subj);
      setEnrolments(enr.filter((e) => e.class_id === classId && e.academic_year_id === yearId && e.status === 'active'));
      setResults(relevantResults);
      const itemLists = await Promise.all(relevantResults.map((r) => apiGet<StudentResultItem[]>(`/v1/results/${r.id}/items`)));
      const map = new Map<string, StudentResultItem[]>();
      relevantResults.forEach((r, i) => map.set(r.id, itemLists[i]));
      setItemsByResult(map);
      setLoading(false);
    });
  }
  useEffect(reload, [classId, yearId]);

  const publishedStructures = structures.filter((s) => s.status === 'published');
  const allPublished = structures.length > 0 && publishedStructures.length === structures.length;
  const rosterStudentIds = useMemo(() => enrolments.map((e) => e.student_id), [enrolments]);

  const resultByStudent = useMemo(() => {
    const map = new Map<string, StudentResult>();
    results.forEach((r) => map.set(r.student_id, r));
    return map;
  }, [results]);

  const studentsMissingSubjects = useMemo(() => {
    return rosterStudentIds
      .map((studentId) => {
        const result = resultByStudent.get(studentId);
        const items = result ? itemsByResult.get(result.id) ?? [] : [];
        const haveSubjectIds = new Set(items.map((i) => i.subject_id));
        const missingSubjectNames = publishedStructures
          .filter((s) => !haveSubjectIds.has(s.subject_id))
          .map((s) => subjects.find((sub) => sub.id === s.subject_id)?.name ?? s.subject_id);
        return { studentId, missingSubjectNames };
      })
      .filter((row) => row.missingSubjectNames.length > 0);
  }, [rosterStudentIds, resultByStudent, itemsByResult, publishedStructures, subjects]);

  const readyToPublishCount = results.filter((r) => r.status === 'approved').length;
  const canPublish = allPublished && studentsMissingSubjects.length === 0 && readyToPublishCount > 0;

  async function handleCreateMissing() {
    setBusy(true);
    setError(null);
    const missingStudentIds = rosterStudentIds.filter((id) => !resultByStudent.has(id));
    for (const studentId of missingStudentIds) {
      await apiFetch('/v1/results', { method: 'POST', body: JSON.stringify({ studentId, classId, academicYearId: yearId }) }).catch(() => undefined);
    }
    reload();
    setBusy(false);
  }

  async function handleResyncAll() {
    setBusy(true);
    for (const r of results.filter((row) => ['draft', 'returned', 'corrected'].includes(row.status))) {
      await apiFetch(`/v1/results/${r.id}/resync`, { method: 'POST' }).catch(() => undefined);
    }
    reload();
    setBusy(false);
  }

  async function bulkTransition(fromStatuses: string[], action: string) {
    setBusy(true);
    setError(null);
    for (const r of results.filter((row) => fromStatuses.includes(row.status))) {
      await apiFetch(`/v1/results/${r.id}/${action}`, { method: 'POST' }).catch(() => undefined);
    }
    reload();
    setBusy(false);
  }

  if (loading) return <LoadingState label="Loading publication gate" rows={6} />;

  return (
    <Card style={{ padding: 'var(--pb-space-4)' }}>
      <div className={styles.formRow}>
        <select
          className={styles.select}
          value={classId}
          onChange={(e) => {
            setClassId(e.target.value);
            setYearId(classes.find((c) => c.id === e.target.value)?.academic_year_id ?? yearId);
          }}
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className={styles.select} value={yearId} onChange={(e) => setYearId(e.target.value)}>
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
            </option>
          ))}
        </select>
      </div>

      <p style={{ fontWeight: 600 }}>
        Publish — {classes.find((c) => c.id === classId)?.name} — {years.find((y) => y.id === yearId)?.name}
      </p>

      <div className={styles.checklistItem}>
        <span className={allPublished ? styles.checkOk : styles.checkFail}>{allPublished ? '✓' : '✕'}</span>
        <span>
          {publishedStructures.length} of {structures.length} subject structures published
        </span>
      </div>
      <div className={styles.checklistItem}>
        <span className={studentsMissingSubjects.length === 0 ? styles.checkOk : styles.checkFail}>{studentsMissingSubjects.length === 0 ? '✓' : '✕'}</span>
        <span>{studentsMissingSubjects.length === 0 ? 'Every student has every published subject snapshotted' : `${studentsMissingSubjects.length} student(s) missing subjects`}</span>
      </div>

      {studentsMissingSubjects.length > 0 && (
        <div style={{ marginLeft: 'var(--pb-space-5)', marginBottom: 'var(--pb-space-3)' }}>
          {studentsMissingSubjects.map((row) => (
            <div key={row.studentId} style={{ fontSize: 'var(--pb-text-caption)', color: 'var(--pb-ink-muted)' }}>
              {studentName(students, row.studentId)} — missing {row.missingSubjectNames.join(', ')}
            </div>
          ))}
        </div>
      )}

      <div className={styles.checklistItem}>
        <span className={styles.checkOk}>ℹ</span>
        <span>
          {rosterStudentIds.length - resultByStudent.size} student(s) with no result record yet; {readyToPublishCount} approved and ready to publish
        </span>
      </div>

      {error && <ErrorState message={error} />}

      {isAdmin && (
        <div className={styles.gateFooter}>
          <div className={styles.actionRow}>
            <Button type="button" variant="secondary" onClick={handleCreateMissing} disabled={busy || rosterStudentIds.length === resultByStudent.size}>
              Create missing results
            </Button>
            <Button type="button" variant="secondary" onClick={handleResyncAll} disabled={busy}>
              Resync all
            </Button>
            <Button type="button" variant="secondary" onClick={() => bulkTransition(['submitted', 'reviewed'], 'approve')} disabled={busy}>
              Approve all submitted/reviewed
            </Button>
          </div>
          <Button type="button" onClick={() => bulkTransition(['approved'], 'publish')} disabled={busy || !canPublish}>
            {canPublish ? `Publish ${readyToPublishCount} result(s)` : 'Publish — conditions not met'}
          </Button>
        </div>
      )}
    </Card>
  );
}
