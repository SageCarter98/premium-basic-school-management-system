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

interface Room {
  id: string;
  name: string;
  capacity: number | null;
}

interface Period {
  id: string;
  name: string;
  sequence: number;
  start_time: string;
  end_time: string;
  period_type: string;
}

interface TimetableEntry {
  id: string;
  academic_year_id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  period_id: string;
  room_id: string | null;
  day_of_week: string;
  status: string;
}

const TABS = ['Academic Years', 'Classes', 'Subjects', 'Teacher Assignments', 'Timetable'] as const;
type Tab = (typeof TABS)[number];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/**
 * SRS Chapter 17 (spec §7.6). One tabbed hub rather than four separate
 * routes — nav-config.ts's single "Academic Structure" link lands here.
 * The Timetable tab (0033_timetable.sql) is intentionally NOT a fixed
 * grid/template: every school defines its own rooms, its own periods
 * (including non-teaching ones — break/assembly/other), and its own
 * weekly pattern from scratch, since Ghanaian basic schools don't share
 * one universal daily structure.
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
        {tab === 'Timetable' && <TimetableTab />}
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

function TimetableTab() {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canConfigure = hasAnyRole(roleCodes, ACADEMIC_ADMIN);
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [teachers, setTeachers] = useState<StaffMember[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);

  const [selectedYearId, setSelectedYearId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');

  const [showRoomForm, setShowRoomForm] = useState(false);
  const [roomForm, setRoomForm] = useState({ name: '', capacity: '' });
  const [showPeriodForm, setShowPeriodForm] = useState(false);
  const [periodForm, setPeriodForm] = useState({ name: '', sequence: '1', startTime: '08:00', endTime: '08:40', periodType: 'teaching' });
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryForm, setEntryForm] = useState({ subjectId: '', teacherId: '', periodId: '', roomId: '', dayOfWeek: 'monday' as (typeof DAYS)[number] });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    Promise.all([
      apiGet<Room[]>('/v1/timetable/rooms'),
      apiGet<Period[]>('/v1/timetable/periods'),
      apiGet<TimetableEntry[]>('/v1/timetable/entries'),
      apiGet<StaffMember[]>('/v1/staff?role=teacher'),
      apiGet<SchoolClass[]>('/v1/classes'),
      apiGet<Subject[]>('/v1/assessment/subjects'),
      apiGet<AcademicYear[]>('/v1/academic-years'),
    ]).then(([r, p, e, t, c, s, y]) => {
      setRooms(r);
      setPeriods(p);
      setEntries(e);
      setTeachers(t);
      setClasses(c);
      setSubjects(s);
      setYears(y);
      setSelectedYearId((v) => v || y[0]?.id || '');
      setSelectedClassId((v) => v || c[0]?.id || '');
      setEntryForm((f) => ({
        ...f,
        subjectId: f.subjectId || s[0]?.id || '',
        teacherId: f.teacherId || t[0]?.id || '',
        periodId: f.periodId || p.find((pd) => pd.period_type === 'teaching')?.id || '',
      }));
      setLoading(false);
    });
  }
  useEffect(reload, []);

  async function handleCreateRoom() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/timetable/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: roomForm.name, capacity: roomForm.capacity ? Number(roomForm.capacity) : undefined }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      setRoomForm({ name: '', capacity: '' });
      setShowRoomForm(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create room.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreatePeriod() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/timetable/periods', {
        method: 'POST',
        body: JSON.stringify({ ...periodForm, sequence: Number(periodForm.sequence) }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      setPeriodForm({ name: '', sequence: '1', startTime: '08:00', endTime: '08:40', periodType: 'teaching' });
      setShowPeriodForm(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create period.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateEntry() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/timetable/entries', {
        method: 'POST',
        body: JSON.stringify({
          academicYearId: selectedYearId,
          classId: selectedClassId,
          subjectId: entryForm.subjectId,
          teacherId: entryForm.teacherId,
          periodId: entryForm.periodId,
          roomId: entryForm.roomId || undefined,
          dayOfWeek: entryForm.dayOfWeek,
        }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      setShowEntryForm(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create timetable entry.');
    } finally {
      setSaving(false);
    }
  }

  async function handleEnd(id: string) {
    await apiFetch(`/v1/timetable/entries/${id}/end`, { method: 'POST', body: JSON.stringify({ reason: 'Ended from Timetable screen' }) });
    reload();
  }

  if (loading) return <LoadingState label="Loading timetable" rows={3} />;

  const teachingPeriods = periods.filter((p) => p.period_type === 'teaching').sort((a, b) => a.sequence - b.sequence);
  const filteredEntries = entries.filter((e) => e.academic_year_id === selectedYearId && e.class_id === selectedClassId && e.status === 'active');

  return (
    <div>
      <p className={styles.hint}>
        Every school builds its own timetable from scratch — add the rooms and periods (including breaks/assembly) this school actually uses, then assign
        classes to teaching periods. Nothing here is a fixed template.
      </p>

      <div className={styles.subPanel}>
        <div className={styles.subPanelTitle}>Rooms</div>
        {canConfigure && (
          <Button type="button" variant="secondary" onClick={() => setShowRoomForm((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
            {showRoomForm ? 'Cancel' : 'Add room'}
          </Button>
        )}
        {canConfigure && showRoomForm && (
          <div className={styles.formRow}>
            <input className={styles.textInput} placeholder="Name, e.g. Block A - Room 1" value={roomForm.name} onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })} />
            <input className={styles.textInput} placeholder="Capacity (optional)" type="number" min={1} value={roomForm.capacity} onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })} />
            <Button type="button" onClick={handleCreateRoom} disabled={saving || !roomForm.name}>
              Save
            </Button>
          </div>
        )}
        {rooms.length === 0 ? (
          <EmptyState title="No rooms yet" message="Add one if this school assigns classes to specific rooms." />
        ) : (
          rooms.map((r) => (
            <div key={r.id} className={styles.listRow}>
              <span>{r.name}</span>
              <span style={{ color: 'var(--pb-ink-muted)' }}>{r.capacity ? `Capacity ${r.capacity}` : ''}</span>
            </div>
          ))
        )}
      </div>

      <div className={styles.subPanel}>
        <div className={styles.subPanelTitle}>Periods</div>
        {canConfigure && (
          <Button type="button" variant="secondary" onClick={() => setShowPeriodForm((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
            {showPeriodForm ? 'Cancel' : 'Add period'}
          </Button>
        )}
        {canConfigure && showPeriodForm && (
          <div className={styles.formRow}>
            <input className={styles.textInput} placeholder="Name, e.g. Period 1 or Lunch" value={periodForm.name} onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })} />
            <input className={styles.textInput} placeholder="Order" type="number" min={1} value={periodForm.sequence} onChange={(e) => setPeriodForm({ ...periodForm, sequence: e.target.value })} />
            <input className={styles.textInput} type="time" value={periodForm.startTime} onChange={(e) => setPeriodForm({ ...periodForm, startTime: e.target.value })} />
            <input className={styles.textInput} type="time" value={periodForm.endTime} onChange={(e) => setPeriodForm({ ...periodForm, endTime: e.target.value })} />
            <select className={styles.select} value={periodForm.periodType} onChange={(e) => setPeriodForm({ ...periodForm, periodType: e.target.value })}>
              <option value="teaching">Teaching</option>
              <option value="break">Break</option>
              <option value="assembly">Assembly</option>
              <option value="other">Other</option>
            </select>
            <Button type="button" onClick={handleCreatePeriod} disabled={saving || !periodForm.name}>
              Save
            </Button>
          </div>
        )}
        {periods.length === 0 ? (
          <EmptyState title="No periods yet" message="Add this school's own daily structure — teaching periods and any breaks/assembly slots." />
        ) : (
          periods
            .slice()
            .sort((a, b) => a.sequence - b.sequence)
            .map((p) => (
              <div key={p.id} className={styles.listRow}>
                <span>
                  {p.name} · {p.start_time.slice(0, 5)}–{p.end_time.slice(0, 5)}
                </span>
                <Pill variant={p.period_type === 'teaching' ? 'success' : 'neutral'}>{p.period_type}</Pill>
              </div>
            ))
        )}
      </div>

      <div className={styles.subPanel}>
        <div className={styles.subPanelTitle}>Weekly entries</div>
        <div className={styles.formRow}>
          <select className={styles.select} value={selectedYearId} onChange={(e) => setSelectedYearId(e.target.value)}>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
          <select className={styles.select} value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {canConfigure && (
            <Button type="button" variant="secondary" onClick={() => setShowEntryForm((v) => !v)}>
              {showEntryForm ? 'Cancel' : 'Add entry'}
            </Button>
          )}
        </div>

        {canConfigure && showEntryForm && (
          <div className={styles.formRow}>
            <select className={styles.select} value={entryForm.subjectId} onChange={(e) => setEntryForm({ ...entryForm, subjectId: e.target.value })}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select className={styles.select} value={entryForm.teacherId} onChange={(e) => setEntryForm({ ...entryForm, teacherId: e.target.value })}>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
            <select className={styles.select} value={entryForm.periodId} onChange={(e) => setEntryForm({ ...entryForm, periodId: e.target.value })}>
              {teachingPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.start_time.slice(0, 5)}–{p.end_time.slice(0, 5)})
                </option>
              ))}
            </select>
            <select className={styles.select} value={entryForm.roomId} onChange={(e) => setEntryForm({ ...entryForm, roomId: e.target.value })}>
              <option value="">No room</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <select className={styles.select} value={entryForm.dayOfWeek} onChange={(e) => setEntryForm({ ...entryForm, dayOfWeek: e.target.value as (typeof DAYS)[number] })}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d[0].toUpperCase() + d.slice(1)}
                </option>
              ))}
            </select>
            <Button type="button" onClick={handleCreateEntry} disabled={saving || !entryForm.subjectId || !entryForm.teacherId || !entryForm.periodId || teachingPeriods.length === 0}>
              Save
            </Button>
          </div>
        )}
        {saveError && <ErrorState message={saveError} />}

        {filteredEntries.length === 0 ? (
          <EmptyState title="No timetable entries yet for this class" message="Add periods first, then assign this class to a teaching period." />
        ) : (
          DAYS.map((day) => {
            const dayEntries = filteredEntries
              .filter((e) => e.day_of_week === day)
              .slice()
              .sort((a, b) => (periods.find((p) => p.id === a.period_id)?.sequence ?? 0) - (periods.find((p) => p.id === b.period_id)?.sequence ?? 0));
            if (dayEntries.length === 0) return null;
            return (
              <div key={day}>
                <div className={styles.dayGroupHeading}>{day}</div>
                {dayEntries.map((e) => {
                  const period = periods.find((p) => p.id === e.period_id);
                  return (
                    <div key={e.id} className={styles.listRow}>
                      <span>
                        {period ? `${period.name} (${period.start_time.slice(0, 5)}–${period.end_time.slice(0, 5)})` : e.period_id} —{' '}
                        {subjects.find((s) => s.id === e.subject_id)?.name ?? e.subject_id} ·{' '}
                        {teachers.find((t) => t.id === e.teacher_id)?.full_name ?? e.teacher_id}
                        {e.room_id && <> · {rooms.find((r) => r.id === e.room_id)?.name ?? e.room_id}</>}
                      </span>
                      {canConfigure && (
                        <Button type="button" variant="secondary" onClick={() => handleEnd(e.id)}>
                          End
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
