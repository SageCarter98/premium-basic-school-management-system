'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { SortDropdown } from '@/components/SortDropdown/SortDropdown';
import { apiFetch, apiGet } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { ACADEMIC_ADMIN, hasAnyRole } from '@/lib/role-groups';
import { useTheme, type ThemePreference } from '@/lib/use-theme';
import styles from '@/styles/tab-hub.module.css';

interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  role_codes: string[];
}

interface Student {
  id: string;
  first_name: string;
  last_name: string;
}

interface Enrolment {
  id: string;
  student_id: string;
  class_id: string;
  status: string;
}

interface SchoolClass {
  id: string;
  name: string;
}

interface AcademicYear {
  id: string;
  name: string;
}

interface Subject {
  id: string;
  name: string;
}

const ROLE_OPTIONS = [
  'proprietor',
  'administrator',
  'headmaster',
  'assistant_headmaster',
  'academic_coordinator',
  'examination_officer',
  'admission_officer',
  'teacher',
  'accountant',
  'librarian',
  'transport_officer',
  'health_officer',
  'storekeeper',
];

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = body?.message;
  return (Array.isArray(m) ? m.join('; ') : m) ?? fallback;
}

/**
 * Settings — currently just Staff (directory + invite). Real screens
 * start Stage 4 per spec §13; this replaces the Stage-2-era stub now
 * that staff.service.ts's inviteStaff() closes what used to be a
 * "read-only, invite is a separate concern" deferral.
 */
const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Match device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsPage() {
  const [theme, setTheme] = useTheme();
  const token = decodeAccessToken();
  const roleCodes = token?.roleCodes ?? [];
  const currentUserId = token?.sub;
  const canManage = hasAnyRole(roleCodes, ACADEMIC_ADMIN);

  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', roleCodes: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmingDeactivateId, setConfirmingDeactivateId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'name' | 'email'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  function reload() {
    setLoading(true);
    apiGet<StaffMember[]>('/v1/staff')
      .then(setStaff)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  function toggleRole(role: string) {
    setForm((f) => ({ ...f, roleCodes: f.roleCodes.includes(role) ? f.roleCodes.filter((r) => r !== role) : [...f.roleCodes, role] }));
  }

  async function invite() {
    setBusy(true);
    setError(null);
    setInviteLink(null);
    try {
      const res = await apiFetch('/v1/staff/invite', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      const result = (await res.json()) as { setPasswordToken: string };
      setInviteLink(`${window.location.origin}/set-password?token=${result.setPasswordToken}`);
      setForm({ fullName: '', email: '', roleCodes: [] });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not invite this staff member.');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(s: StaffMember) {
    setEditingId(s.id);
    setEditRoles(s.role_codes);
    setRowError(null);
    setConfirmingDeactivateId(null);
  }

  function toggleEditRole(role: string) {
    setEditRoles((rs) => (rs.includes(role) ? rs.filter((r) => r !== role) : [...rs, role]));
  }

  async function saveRoles(id: string) {
    setBusy(true);
    setRowError(null);
    try {
      const res = await apiFetch(`/v1/staff/${id}/roles`, { method: 'PATCH', body: JSON.stringify({ roleCodes: editRoles }) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setEditingId(null);
      reload();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Could not update roles.');
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(id: string) {
    setBusy(true);
    setRowError(null);
    try {
      const res = await apiFetch(`/v1/staff/${id}/deactivate`, { method: 'POST' });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setConfirmingDeactivateId(null);
      reload();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Could not deactivate this staff member.');
    } finally {
      setBusy(false);
    }
  }

  const sortedStaff = useMemo(() => {
    const dir = sortDirection === 'asc' ? 1 : -1;
    return staff.slice().sort((a, b) => (sortField === 'email' ? a.email.localeCompare(b.email) : a.full_name.localeCompare(b.full_name)) * dir);
  }, [staff, sortField, sortDirection]);

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading settings" rows={4} />
      </Card>
    );
  }

  return (
    <>
      <Card style={{ padding: 'var(--pb-space-4)', marginBottom: 'var(--pb-space-4)' }}>
        <p className={styles.hint}>Appearance</p>
        <div className={styles.formRow} style={{ marginTop: 'var(--pb-space-2)' }}>
          {THEME_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              variant={theme === opt.value ? 'primary' : 'secondary'}
              onClick={() => setTheme(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card style={{ padding: 'var(--pb-space-4)', marginBottom: 'var(--pb-space-4)' }}>
        <p className={styles.hint}>Feedback</p>
        <FeedbackCard canManage={canManage} />
      </Card>

      {canManage && (
        <Card style={{ padding: 'var(--pb-space-4)', marginBottom: 'var(--pb-space-4)' }}>
          <p className={styles.hint}>Class assignments</p>
          <ClassAssignmentsCard />
        </Card>
      )}

      {canManage && (
        <Card style={{ padding: 'var(--pb-space-4)', marginBottom: 'var(--pb-space-4)' }}>
          <p className={styles.hint}>Guardian access requests</p>
          <GuardianAccessRequestsCard />
        </Card>
      )}

      <Card style={{ padding: 'var(--pb-space-4)' }}>
      <p className={styles.hint}>Staff directory</p>

      {canManage && (
        <Button type="button" variant="secondary" onClick={() => { setShowInvite((v) => !v); setInviteLink(null); }} style={{ margin: 'var(--pb-space-3) 0' }}>
          {showInvite ? 'Cancel' : 'Invite staff member'}
        </Button>
      )}

      {showInvite && (
        <div className={styles.detailPanel} style={{ marginBottom: 'var(--pb-space-3)' }}>
          <div className={styles.formRow}>
            <input aria-label="Full name" className={styles.textInput} placeholder="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            <input aria-label="Email" className={styles.textInput} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <p className={styles.hint} style={{ marginTop: 'var(--pb-space-2)' }}>
            Roles
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pb-space-2)', marginBottom: 'var(--pb-space-3)' }}>
            {ROLE_OPTIONS.map((role) => (
              <label key={role} className={styles.checklistItem} style={{ gap: 4 }}>
                <input type="checkbox" checked={form.roleCodes.includes(role)} onChange={() => toggleRole(role)} />
                {role.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
          <Button type="button" onClick={invite} disabled={busy || !form.fullName || !form.email || form.roleCodes.length === 0}>
            Send invite
          </Button>
          {error && <ErrorState message={error} />}
          {inviteLink && (
            <div style={{ marginTop: 'var(--pb-space-3)' }}>
              <p className={styles.hint}>
                No email provider is wired up in this environment — share this link with the new staff member yourself. It expires in 7 days.
              </p>
              <input aria-label="Invite link" className={styles.textInput} readOnly value={inviteLink} onFocus={(e) => e.currentTarget.select()} style={{ width: '100%' }} />
            </div>
          )}
        </div>
      )}

      {rowError && <ErrorState message={rowError} />}

      {staff.length > 0 && (
        <div style={{ marginBottom: 'var(--pb-space-3)' }}>
          <SortDropdown
            options={[
              { value: 'name', label: 'Name' },
              { value: 'email', label: 'Email' },
            ]}
            value={sortField}
            direction={sortDirection}
            onChange={(v, d) => {
              setSortField(v as 'name' | 'email');
              setSortDirection(d);
            }}
          />
        </div>
      )}

      {staff.length === 0 ? (
        <EmptyState title="No staff yet" message="Invite one to get started." />
      ) : (
        sortedStaff.map((s) => (
          <div key={s.id} className={styles.detailPanel} style={{ marginBottom: 'var(--pb-space-2)' }}>
            <div className={styles.listRow}>
              <span>
                {s.full_name} <span className={styles.hint}>({s.email})</span>
              </span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                {editingId === s.id ? null : s.role_codes.map((rc) => (
                  <Pill key={rc} variant="neutral">
                    {rc.replace(/_/g, ' ')}
                  </Pill>
                ))}
                {canManage && editingId !== s.id && (
                  <Button type="button" variant="secondary" onClick={() => startEdit(s)}>
                    Edit roles
                  </Button>
                )}
                {canManage && s.id !== currentUserId && editingId !== s.id && (
                  confirmingDeactivateId === s.id ? (
                    <>
                      <span className={styles.hint}>Remove all access for {s.full_name}?</span>
                      <Button type="button" onClick={() => deactivate(s.id)} disabled={busy}>
                        Confirm deactivate
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setConfirmingDeactivateId(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button type="button" variant="secondary" onClick={() => setConfirmingDeactivateId(s.id)}>
                      Deactivate
                    </Button>
                  )
                )}
              </span>
            </div>
            {editingId === s.id && (
              <div style={{ marginTop: 'var(--pb-space-2)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pb-space-2)', marginBottom: 'var(--pb-space-2)' }}>
                  {ROLE_OPTIONS.map((role) => (
                    <label key={role} className={styles.checklistItem} style={{ gap: 4 }}>
                      <input type="checkbox" checked={editRoles.includes(role)} onChange={() => toggleEditRole(role)} />
                      {role.replace(/_/g, ' ')}
                    </label>
                  ))}
                </div>
                <Button type="button" onClick={() => saveRoles(s.id)} disabled={busy || editRoles.length === 0}>
                  Save roles
                </Button>{' '}
                <Button type="button" variant="secondary" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        ))
      )}
      </Card>
    </>
  );
}

/**
 * Compact student-class reassignment + teacher-assignment shortcut — the
 * two things bug item #11 asked to be "accessible at settings." Full
 * teacher-assignment management (view all, end an assignment, Class
 * Teacher flag) still lives on Academic Structure's own Teacher
 * Assignments tab; this is deliberately a quick-action form, not a
 * duplicate of that screen.
 */
function ClassAssignmentsCard() {
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [teachers, setTeachers] = useState<StaffMember[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);

  const [reassignStudentId, setReassignStudentId] = useState('');
  const [reassignClassId, setReassignClassId] = useState('');
  const [reassignBusy, setReassignBusy] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [reassignDone, setReassignDone] = useState(false);

  const [assignForm, setAssignForm] = useState({ teacherId: '', classId: '', subjectId: '', academicYearId: '' });
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignDone, setAssignDone] = useState(false);

  useEffect(() => {
    Promise.all([
      apiGet<Student[]>('/v1/students'),
      apiGet<Enrolment[]>('/v1/enrolments'),
      apiGet<SchoolClass[]>('/v1/classes'),
      apiGet<StaffMember[]>('/v1/staff?role=teacher'),
      apiGet<Subject[]>('/v1/assessment/subjects'),
      apiGet<AcademicYear[]>('/v1/academic-years'),
    ]).then(([s, e, c, t, sub, y]) => {
      setStudents(s);
      setEnrolments(e);
      setClasses(c);
      setTeachers(t);
      setSubjects(sub);
      setYears(y);
      setReassignStudentId((v) => v || s[0]?.id || '');
      setAssignForm((f) => ({
        teacherId: f.teacherId || t[0]?.id || '',
        classId: f.classId || c[0]?.id || '',
        subjectId: f.subjectId || sub[0]?.id || '',
        academicYearId: f.academicYearId || y[0]?.id || '',
      }));
      setLoading(false);
    });
  }, []);

  const activeEnrolment = enrolments.find((e) => e.student_id === reassignStudentId && e.status === 'active');

  async function reassign() {
    if (!activeEnrolment || !reassignClassId) return;
    setReassignBusy(true);
    setReassignError(null);
    setReassignDone(false);
    const res = await apiFetch(`/v1/enrolments/${activeEnrolment.id}/class`, { method: 'PATCH', body: JSON.stringify({ classId: reassignClassId }) });
    setReassignBusy(false);
    if (!res.ok) return setReassignError(await errorMessage(res, `Failed (${res.status})`));
    setEnrolments((rows) => rows.map((r) => (r.id === activeEnrolment.id ? { ...r, class_id: reassignClassId } : r)));
    setReassignDone(true);
  }

  async function assignTeacher() {
    setAssignBusy(true);
    setAssignError(null);
    setAssignDone(false);
    const res = await apiFetch('/v1/teacher-assignments', { method: 'POST', body: JSON.stringify(assignForm) });
    setAssignBusy(false);
    if (!res.ok) return setAssignError(await errorMessage(res, `Failed (${res.status})`));
    setAssignDone(true);
  }

  if (loading) return <LoadingState label="Loading class assignment data" rows={2} />;

  return (
    <div>
      <p style={{ fontWeight: 600, marginBottom: 'var(--pb-space-2)' }}>Reassign a student's class</p>
      <div className={styles.formRow}>
        <select
          className={styles.select}
          value={reassignStudentId}
          onChange={(e) => {
            setReassignStudentId(e.target.value);
            setReassignDone(false);
          }}
        >
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.last_name}, {s.first_name}
            </option>
          ))}
        </select>
        {activeEnrolment ? (
          <>
            <span className={styles.hint}>currently {classes.find((c) => c.id === activeEnrolment.class_id)?.name ?? activeEnrolment.class_id}</span>
            <select className={styles.select} value={reassignClassId} onChange={(e) => setReassignClassId(e.target.value)}>
              <option value="">New class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Button type="button" onClick={reassign} disabled={reassignBusy || !reassignClassId || reassignClassId === activeEnrolment.class_id}>
              Reassign
            </Button>
          </>
        ) : (
          <span className={styles.hint}>No active enrolment for this student.</span>
        )}
      </div>
      {reassignError && <ErrorState message={reassignError} />}
      {reassignDone && <p className={styles.hint}>Class updated.</p>}

      <p style={{ fontWeight: 600, margin: 'var(--pb-space-4) 0 var(--pb-space-2)' }}>Assign a teacher to a class</p>
      {teachers.length === 0 || subjects.length === 0 || years.length === 0 ? (
        <p className={styles.hint}>Needs at least one teacher, subject and academic year on file first.</p>
      ) : (
        <>
          <div className={styles.formRow}>
            <select className={styles.select} value={assignForm.teacherId} onChange={(e) => setAssignForm({ ...assignForm, teacherId: e.target.value })}>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
            <select className={styles.select} value={assignForm.classId} onChange={(e) => setAssignForm({ ...assignForm, classId: e.target.value })}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select className={styles.select} value={assignForm.subjectId} onChange={(e) => setAssignForm({ ...assignForm, subjectId: e.target.value })}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select className={styles.select} value={assignForm.academicYearId} onChange={(e) => setAssignForm({ ...assignForm, academicYearId: e.target.value })}>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </select>
            <Button type="button" onClick={assignTeacher} disabled={assignBusy}>
              Assign
            </Button>
          </div>
          {assignError && <ErrorState message={assignError} />}
          {assignDone && <p className={styles.hint}>Assigned. Manage or end assignments from Academic Structure's Teacher Assignments tab.</p>}
        </>
      )}
    </div>
  );
}

interface GuardianAccessRequest {
  id: string;
  student_id: string;
  requester_name: string;
  requester_phone: string | null;
  requester_email: string | null;
  relationship: string | null;
  message: string | null;
  status: string;
  created_at: string;
}

/**
 * Staff-side review queue for the public /request-guardian-access form
 * (guardians.controller.ts's submitAccessRequest(), the one PUBLIC route
 * in that module). Only ever shows 'pending' requests — approved/rejected
 * ones have nothing left to do, same "don't make staff re-scroll past
 * resolved items" posture Compliance's DSR tab's "Overdue only" filter
 * exists for, just simpler here since there's no comparable ongoing-work
 * state to filter by.
 */
function GuardianAccessRequestsCard() {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<GuardianAccessRequest[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');

  function reload() {
    setLoading(true);
    Promise.all([
      apiGet<GuardianAccessRequest[]>('/v1/guardian-access-requests?status=pending'),
      apiGet<Student[]>('/v1/students'),
    ])
      .then(([r, s]) => {
        setRequests(r);
        setStudents(s);
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  function studentLabel(id: string) {
    const s = students.find((st) => st.id === id);
    return s ? `${s.last_name}, ${s.first_name}` : id;
  }

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await apiFetch(`/v1/guardian-access-requests/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ hasReportAccess: true }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve this request.');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await apiFetch(`/v1/guardian-access-requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reviewNotes: rejectNotes || undefined }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setRejectingId(null);
      setRejectNotes('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reject this request.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <LoadingState label="Loading guardian access requests" rows={2} />;

  if (requests.length === 0) {
    return <EmptyState title="No pending requests" message="Guardian self-requests from /request-guardian-access appear here." />;
  }

  return (
    <div>
      {error && <ErrorState message={error} />}
      {requests.map((r) => (
        <div key={r.id} className={styles.detailPanel} style={{ marginBottom: 'var(--pb-space-2)' }}>
          <div className={styles.listRow}>
            <span>
              {r.requester_name}
              {r.relationship ? ` (${r.relationship})` : ''} — requesting access to {studentLabel(r.student_id)}
              <br />
              <span className={styles.hint}>
                {r.requester_phone ?? r.requester_email ?? 'no contact given'} · {new Date(r.created_at).toLocaleDateString()}
              </span>
            </span>
            <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
              <Button type="button" onClick={() => approve(r.id)} disabled={busyId === r.id}>
                Approve
              </Button>
              <Button type="button" variant="secondary" onClick={() => setRejectingId(rejectingId === r.id ? null : r.id)}>
                Reject
              </Button>
            </span>
          </div>
          {r.message && <p className={styles.hint}>&quot;{r.message}&quot;</p>}
          {rejectingId === r.id && (
            <div className={styles.formRow} style={{ marginTop: 'var(--pb-space-2)' }}>
              <input
                className={styles.textInput}
                placeholder="Reason (optional)"
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
              />
              <Button type="button" onClick={() => reject(r.id)} disabled={busyId === r.id}>
                Confirm reject
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface StaffFeedback {
  id: string;
  submitted_by: string;
  subject: string;
  message: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
}

const FEEDBACK_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  submitted: 'neutral',
  on_hold: 'warning',
  accepted: 'success',
  rejected: 'danger',
};

/**
 * "Individual role feedbacks... forwarded to school admin for review then
 * either accept, reject or place on hold." Any staff member (not just
 * canManage) can submit — the backend itself scopes GET to "my own
 * submissions" for anyone below ACADEMIC_ADMIN, so a plain teacher only
 * ever sees their own feedback's status here, never a colleague's.
 */
function FeedbackCard({ canManage }: { canManage: boolean }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<StaffFeedback[]>([]);
  const [showSubmit, setShowSubmit] = useState(false);
  const [form, setForm] = useState({ subject: '', message: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<StaffFeedback[]>('/v1/staff-feedback')
      .then(setItems)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/v1/staff-feedback', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm({ subject: '', message: '' });
      setShowSubmit(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit feedback.');
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, action: 'accept' | 'reject' | 'hold' | 'reopen') {
    setBusyId(id);
    setError(null);
    try {
      const res = await apiFetch(`/v1/staff-feedback/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ adminNotes: notesById[id] || undefined }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} this feedback.`);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <LoadingState label="Loading feedback" rows={2} />;

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowSubmit((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showSubmit ? 'Cancel' : 'Submit feedback'}
      </Button>
      {showSubmit && (
        <div className={styles.detailPanel} style={{ marginBottom: 'var(--pb-space-3)' }}>
          <div className={styles.formRow}>
            <input className={styles.textInput} placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </div>
          <div className={styles.formRow}>
            <textarea className={styles.textArea} placeholder="Your feedback" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </div>
          <Button type="button" onClick={submit} disabled={saving || !form.subject || !form.message}>
            Send
          </Button>
        </div>
      )}
      {error && <ErrorState message={error} />}

      {items.length === 0 ? (
        <EmptyState title="No feedback yet" message={canManage ? 'Submissions from any staff member appear here.' : 'Your submissions appear here.'} />
      ) : (
        items.map((f) => (
          <div key={f.id} className={styles.detailPanel} style={{ marginBottom: 'var(--pb-space-2)' }}>
            <div className={styles.listRow}>
              <span>
                <strong>{f.subject}</strong> — {f.message}
                <br />
                <span className={styles.hint}>{new Date(f.created_at).toLocaleDateString()}</span>
              </span>
              <Pill variant={FEEDBACK_STATUS_VARIANT[f.status] ?? 'neutral'}>{f.status.replace('_', ' ')}</Pill>
            </div>
            {f.admin_notes && <p className={styles.hint}>Admin notes: {f.admin_notes}</p>}
            {canManage && (f.status === 'submitted' || f.status === 'on_hold') && (
              <div className={styles.formRow} style={{ marginTop: 'var(--pb-space-2)' }}>
                <input
                  className={styles.textInput}
                  placeholder="Notes (optional)"
                  value={notesById[f.id] ?? ''}
                  onChange={(e) => setNotesById({ ...notesById, [f.id]: e.target.value })}
                />
                <Button type="button" onClick={() => act(f.id, 'accept')} disabled={busyId === f.id}>
                  Accept
                </Button>
                <Button type="button" variant="secondary" onClick={() => act(f.id, 'reject')} disabled={busyId === f.id}>
                  Reject
                </Button>
                {f.status === 'submitted' && (
                  <Button type="button" variant="secondary" onClick={() => act(f.id, 'hold')} disabled={busyId === f.id}>
                    Hold
                  </Button>
                )}
                {f.status === 'on_hold' && (
                  <Button type="button" variant="secondary" onClick={() => act(f.id, 'reopen')} disabled={busyId === f.id}>
                    Reopen
                  </Button>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
