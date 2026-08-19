'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { apiFetch, apiGet } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { ACADEMIC_ADMIN, hasAnyRole } from '@/lib/role-groups';
import styles from './academic-structure.module.css';

interface AcademicYear {
  id: string;
  school_id: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

interface SchoolClass {
  id: string;
  academic_year_id: string;
  name: string;
  level: string;
}

interface Subject {
  id: string;
  name: string;
  code: string;
}

interface TeacherAssignment {
  id: string;
  teacher_id: string;
  class_id: string;
  subject_id: string;
  academic_year_id: string;
  status: string;
}

interface StaffMember {
  id: string;
  full_name: string;
}

interface School {
  id: string;
  name: string;
}

const TABS = ['Academic Years', 'Classes', 'Subjects', 'Teacher Assignments'] as const;
type Tab = (typeof TABS)[number];

/**
 * SRS Chapter 17 (spec §7.6). One tabbed hub rather than four separate
 * routes — nav-config.ts's single "Academic Structure" link lands here;
 * a Timetable builder/views pair is also named in the spec's inventory
 * but has no backing schema at all (no periods/rooms/timetable table
 * anywhere in apps/api) — genuinely blocked, not deferred by choice,
 * flagged in the README rather than faked with a non-functional screen.
 */
export default function AcademicStructurePage() {
  const [tab, setTab] = useState<Tab>('Academic Years');

  return (
    <div>
      <div className={styles.tabBar} role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={[styles.tabBtn, tab === t ? styles.tabBtnActive : ''].filter(Boolean).join(' ')}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <Card style={{ padding: 'var(--pb-space-4)' }}>
        {tab === 'Academic Years' && <AcademicYearsTab />}
        {tab === 'Classes' && <ClassesTab />}
        {tab === 'Subjects' && <SubjectsTab />}
        {tab === 'Teacher Assignments' && <TeacherAssignmentsTab />}
      </Card>
    </div>
  );
}

function AcademicYearsTab() {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canConfigure = hasAnyRole(roleCodes, ACADEMIC_ADMIN);
  const [loading, setLoading] = useState(true);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ schoolId: '', name: '', status: 'planned' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    Promise.all([apiGet<AcademicYear[]>('/v1/academic-years'), apiGet<School[]>('/v1/schools')])
      .then(([y, s]) => {
        setYears(y);
        setSchools(s);
        setForm((f) => ({ ...f, schoolId: f.schoolId || s[0]?.id || '' }));
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/academic-years', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      setForm((f) => ({ ...f, name: '' }));
      setShowCreate(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create academic year.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading academic years" rows={3} />;

  return (
    <div>
      {canConfigure && (
        <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
          {showCreate ? 'Cancel' : 'Add academic year'}
        </Button>
      )}
      {canConfigure && showCreate && (
        <div className={styles.formRow}>
          <select className={styles.select} value={form.schoolId} onChange={(e) => setForm({ ...form, schoolId: e.target.value })}>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input className={styles.textInput} placeholder="e.g. 2026/2027" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className={styles.select} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="planned">Planned</option>
            <option value="active">Active</option>
          </select>
          <Button type="button" onClick={handleCreate} disabled={saving || !form.name}>
            Save
          </Button>
        </div>
      )}
      {saveError && <ErrorState message={saveError} />}
      {years.length === 0 ? (
        <EmptyState title="No academic years yet" message="Add one to start building classes and assessments." />
      ) : (
        years.map((y) => (
          <div key={y.id} className={styles.listRow}>
            <span>{y.name}</span>
            <Pill variant={y.status === 'active' ? 'success' : 'neutral'}>{y.status}</Pill>
          </div>
        ))
      )}
    </div>
  );
}

function ClassesTab() {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canConfigure = hasAnyRole(roleCodes, ACADEMIC_ADMIN);
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ academicYearId: '', name: '', level: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    Promise.all([apiGet<SchoolClass[]>('/v1/classes'), apiGet<AcademicYear[]>('/v1/academic-years')])
      .then(([c, y]) => {
        setClasses(c);
        setYears(y);
        setForm((f) => ({ ...f, academicYearId: f.academicYearId || y[0]?.id || '' }));
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/classes', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      setForm((f) => ({ ...f, name: '', level: '' }));
      setShowCreate(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create class.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading classes" rows={3} />;

  return (
    <div>
      {canConfigure && (
        <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
          {showCreate ? 'Cancel' : 'Add class'}
        </Button>
      )}
      {canConfigure && showCreate && (
        <div className={styles.formRow}>
          <select className={styles.select} value={form.academicYearId} onChange={(e) => setForm({ ...form, academicYearId: e.target.value })}>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
          <input className={styles.textInput} placeholder="Name, e.g. JHS 2A" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={styles.textInput} placeholder="Level, e.g. JHS 2" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} />
          <Button type="button" onClick={handleCreate} disabled={saving || !form.name || !form.level}>
            Save
          </Button>
        </div>
      )}
      {saveError && <ErrorState message={saveError} />}
      {classes.length === 0 ? (
        <EmptyState title="No classes yet" message="Add one once an academic year exists." />
      ) : (
        classes.map((c) => (
          <div key={c.id} className={styles.listRow}>
            <span>{c.name}</span>
            <span style={{ color: 'var(--pb-ink-muted)' }}>{years.find((y) => y.id === c.academic_year_id)?.name ?? c.academic_year_id}</span>
          </div>
        ))
      )}
    </div>
  );
}

function SubjectsTab() {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canConfigure = hasAnyRole(roleCodes, ACADEMIC_ADMIN);
  const [loading, setLoading] = useState(true);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', code: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<Subject[]>('/v1/assessment/subjects')
      .then(setSubjects)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/assessment/subjects', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      setForm({ name: '', code: '' });
      setShowCreate(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create subject.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading subjects" rows={3} />;

  return (
    <div>
      {canConfigure && (
        <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
          {showCreate ? 'Cancel' : 'Add subject'}
        </Button>
      )}
      {canConfigure && showCreate && (
        <div className={styles.formRow}>
          <input className={styles.textInput} placeholder="Name, e.g. Mathematics" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={styles.textInput} placeholder="Code, e.g. MATH" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <Button type="button" onClick={handleCreate} disabled={saving || !form.name || !form.code}>
            Save
          </Button>
        </div>
      )}
      {saveError && <ErrorState message={saveError} />}
      {subjects.length === 0 ? (
        <EmptyState title="No subjects yet" message="Add one before creating an assessment structure." />
      ) : (
        subjects.map((s) => (
          <div key={s.id} className={styles.listRow}>
            <span>{s.name}</span>
            <span style={{ color: 'var(--pb-ink-muted)' }}>{s.code}</span>
          </div>
        ))
      )}
    </div>
  );
}

function TeacherAssignmentsTab() {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canConfigure = hasAnyRole(roleCodes, ACADEMIC_ADMIN);
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [teachers, setTeachers] = useState<StaffMember[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ teacherId: '', classId: '', subjectId: '', academicYearId: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    Promise.all([
      apiGet<TeacherAssignment[]>('/v1/teacher-assignments'),
      apiGet<StaffMember[]>('/v1/staff?role=teacher'),
      apiGet<SchoolClass[]>('/v1/classes'),
      apiGet<Subject[]>('/v1/assessment/subjects'),
      apiGet<AcademicYear[]>('/v1/academic-years'),
    ]).then(([a, t, c, s, y]) => {
      setAssignments(a);
      setTeachers(t);
      setClasses(c);
      setSubjects(s);
      setYears(y);
      setForm((f) => ({
        teacherId: f.teacherId || t[0]?.id || '',
        classId: f.classId || c[0]?.id || '',
        subjectId: f.subjectId || s[0]?.id || '',
        academicYearId: f.academicYearId || y[0]?.id || '',
      }));
      setLoading(false);
    });
  }
  useEffect(reload, []);

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/teacher-assignments', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      setShowCreate(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create assignment.');
    } finally {
      setSaving(false);
    }
  }

  async function handleEnd(id: string) {
    await apiFetch(`/v1/teacher-assignments/${id}/end`, { method: 'POST', body: JSON.stringify({ reason: 'Ended from Academic Structure screen' }) });
    reload();
  }

  if (loading) return <LoadingState label="Loading teacher assignments" rows={3} />;

  return (
    <div>
      {canConfigure && (
        <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
          {showCreate ? 'Cancel' : 'Add assignment'}
        </Button>
      )}
      {canConfigure && showCreate && (
        <div className={styles.formRow}>
          <select className={styles.select} value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name}
              </option>
            ))}
          </select>
          <select className={styles.select} value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className={styles.select} value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select className={styles.select} value={form.academicYearId} onChange={(e) => setForm({ ...form, academicYearId: e.target.value })}>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
          <Button type="button" onClick={handleCreate} disabled={saving || !form.teacherId || !form.classId || !form.subjectId || !form.academicYearId}>
            Save
          </Button>
        </div>
      )}
      {saveError && <ErrorState message={saveError} />}
      {assignments.length === 0 ? (
        <EmptyState title="No teacher assignments yet" message="Assign a teacher to a class and subject before they can mark attendance or enter scores." />
      ) : (
        assignments.map((a) => (
          <div key={a.id} className={styles.listRow}>
            <span>
              {teachers.find((t) => t.id === a.teacher_id)?.full_name ?? a.teacher_id} — {classes.find((c) => c.id === a.class_id)?.name ?? a.class_id} ·{' '}
              {subjects.find((s) => s.id === a.subject_id)?.name ?? a.subject_id} · {years.find((y) => y.id === a.academic_year_id)?.name ?? a.academic_year_id}
            </span>
            <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
              <Pill variant={a.status === 'active' ? 'success' : 'neutral'}>{a.status}</Pill>
              {canConfigure && a.status === 'active' && (
                <Button type="button" variant="secondary" onClick={() => handleEnd(a.id)}>
                  End
                </Button>
              )}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
