'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { apiFetch, apiGet } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { ACADEMIC_ADMIN, hasAnyRole } from '@/lib/role-groups';
import styles from './students.module.css';

interface Student {
  id: string;
  school_id: string;
  admission_no: string;
  first_name: string;
  last_name: string;
  status: string;
}

interface SchoolClass {
  id: string;
  name: string;
}

interface Enrolment {
  student_id: string;
  class_id: string;
  status: string;
}

interface School {
  id: string;
  name: string;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success',
  transferred: 'warning',
  withdrawn: 'danger',
  graduated: 'neutral',
  archived: 'neutral',
};

/**
 * FR-STU-010 (SRS Chapter 16). `/v1/students` has no server-side filter —
 * checked before writing this, same gap Stage 3/4 already found in
 * classes/enrolments — so search/class-filter both run client-side over
 * the tenant-wide list. Fine at seed-data scale; flagged, not hidden.
 * Current class is resolved via each student's ACTIVE enrolment, not a
 * denormalized column on `students` (there isn't one — enrolment is
 * deliberately year-scoped, students are permanent).
 */
export default function StudentsPage() {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canCreate = hasAnyRole(roleCodes, ACADEMIC_ADMIN);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState({ schoolId: '', admissionNo: '', firstName: '', lastName: '' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiGet<Student[]>('/v1/students'),
      apiGet<SchoolClass[]>('/v1/classes'),
      apiGet<Enrolment[]>('/v1/enrolments'),
      apiGet<School[]>('/v1/schools'),
    ])
      .then(([s, c, e, sch]) => {
        if (cancelled) return;
        setStudents(s);
        setClasses(c);
        setEnrolments(e);
        setSchools(sch);
        setForm((f) => ({ ...f, schoolId: sch[0]?.id ?? '' }));
      })
      .catch(() => {
        if (!cancelled) setError('Could not load students.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const classByStudent = useMemo(() => {
    const map = new Map<string, string>();
    enrolments
      .filter((e) => e.status === 'active')
      .forEach((e) => map.set(e.student_id, e.class_id));
    return map;
  }, [enrolments]);

  const visibleStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (classFilter && classByStudent.get(s.id) !== classFilter) return false;
      if (!q) return true;
      return (
        `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) || s.admission_no.toLowerCase().includes(q)
      );
    });
  }, [students, search, classFilter, classByStudent]);

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiFetch('/v1/students', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Could not create student (${res.status})`);
      }
      const created = (await res.json()) as Student;
      setStudents((prev) => [...prev, created]);
      setForm((f) => ({ ...f, admissionNo: '', firstName: '', lastName: '' }));
      setShowCreate(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create student.');
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading students" rows={6} />
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <ErrorState message={error} />
      </Card>
    );
  }

  return (
    <div>
      {canCreate && (
        <div style={{ marginBottom: 'var(--pb-space-3)' }}>
          <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Cancel' : 'Add student'}
          </Button>
        </div>
      )}

      {showCreate && (
        <Card className={styles.createForm}>
          <div className={styles.formRow}>
            <select
              className={styles.select}
              value={form.schoolId}
              onChange={(e) => setForm({ ...form, schoolId: e.target.value })}
            >
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              className={styles.textInput}
              placeholder="Admission number"
              value={form.admissionNo}
              onChange={(e) => setForm({ ...form, admissionNo: e.target.value })}
            />
          </div>
          <div className={styles.formRow}>
            <input
              className={styles.textInput}
              placeholder="First name"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
            <input
              className={styles.textInput}
              placeholder="Last name"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </div>
          {createError && <ErrorState message={createError} />}
          <div>
            <Button
              type="button"
              onClick={handleCreate}
              disabled={creating || !form.schoolId || !form.admissionNo || !form.firstName || !form.lastName}
            >
              Save student
            </Button>
          </div>
        </Card>
      )}

      <Card style={{ padding: 'var(--pb-space-4)' }}>
        <div className={styles.toolbar}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search by name or admission number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search students"
          />
          <select className={styles.select} value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {visibleStudents.length === 0 ? (
          <EmptyState title="No students found" message="Try a different search or clear the class filter." />
        ) : (
          <div>
            {visibleStudents.map((s) => {
              const classId = classByStudent.get(s.id);
              const className = classes.find((c) => c.id === classId)?.name;
              return (
                <Link key={s.id} href={`/students/${s.id}`} className={styles.row}>
                  <div>
                    <div className={styles.name}>
                      {s.last_name}, {s.first_name}
                    </div>
                    <div className={styles.meta}>
                      {s.admission_no}
                      {className ? ` · ${className}` : ''}
                    </div>
                  </div>
                  <Pill variant={STATUS_VARIANT[s.status] ?? 'neutral'}>{s.status}</Pill>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
