'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { RestrictedState } from '@/components/states/RestrictedState';
import { SortDropdown } from '@/components/SortDropdown/SortDropdown';
import { apiFetch, apiGet } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { ADMISSIONS_TEAM, hasAnyRole } from '@/lib/role-groups';
import styles from '@/styles/tab-hub.module.css';

interface DocumentChecklistItem {
  name: string;
  received: boolean;
}

interface Applicant {
  id: string;
  school_id: string;
  first_name: string;
  last_name: string;
  dob: string | null;
  gender: string | null;
  previous_school: string | null;
  status: string;
  admission_no: string | null;
  student_id: string | null;
  photo_url: string | null;
  nationality: string | null;
  home_language: string | null;
  address: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
  guardian_relationship: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  medical_notes: string | null;
  learning_support_notes: string | null;
  documents_checklist: DocumentChecklistItem[];
  interview_date: string | null;
  interview_notes: string | null;
  assessment_notes: string | null;
}

interface School {
  id: string;
  name: string;
}

interface AcademicYear {
  id: string;
  name: string;
}

interface SchoolClass {
  id: string;
  name: string;
}

const STATUS_OPTIONS = [
  'draft',
  'submitted',
  'under_review',
  'documents_incomplete',
  'interview_scheduled',
  'waitlisted',
  'approved',
  'rejected',
  'cancelled',
];

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'gold'> = {
  draft: 'neutral',
  submitted: 'neutral',
  under_review: 'warning',
  documents_incomplete: 'warning',
  interview_scheduled: 'warning',
  waitlisted: 'warning',
  approved: 'gold',
  rejected: 'danger',
  cancelled: 'danger',
  admitted: 'success',
};

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = body?.message;
  return (Array.isArray(m) ? m.join('; ') : m) ?? fallback;
}

/**
 * Admissions (SRS Chapter 15, FR-ADM-010..050) — the gap flagged during
 * the 2026-08-24 bug-list closure: admissions.service.ts's convert()
 * already required a classId to turn an applicant into an enrolled
 * student, but no screen anywhere could reach create()/updateStatus()/
 * convert() at all. This is a genuinely new screen, not a Stage N/M
 * continuation, hence the "gap closure" stageNote in nav-config.ts.
 */
export default function AdmissionsPage() {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canManage = hasAnyRole(roleCodes, ADMISSIONS_TEAM);

  const [loading, setLoading] = useState(true);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [sortField, setSortField] = useState<'name' | 'status'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ schoolId: '', firstName: '', lastName: '', dob: '', gender: '', previousSchool: '' });
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    Promise.all([
      apiGet<Applicant[]>('/v1/admissions'),
      apiGet<School[]>('/v1/schools'),
      apiGet<AcademicYear[]>('/v1/academic-years'),
      apiGet<SchoolClass[]>('/v1/classes'),
    ])
      .then(([a, sch, y, c]) => {
        setApplicants(a);
        setSchools(sch);
        setYears(y);
        setClasses(c);
        setForm((f) => ({ ...f, schoolId: f.schoolId || sch[0]?.id || '' }));
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function handleCreate() {
    setSaving(true);
    setCreateError(null);
    try {
      const res = await apiFetch('/v1/admissions', {
        method: 'POST',
        body: JSON.stringify({ ...form, dob: form.dob || undefined, gender: form.gender || undefined, previousSchool: form.previousSchool || undefined }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm((f) => ({ ...f, firstName: '', lastName: '', dob: '', gender: '', previousSchool: '' }));
      setShowCreate(false);
      reload();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create applicant.');
    } finally {
      setSaving(false);
    }
  }

  const visible = useMemo(() => {
    const filtered = statusFilter ? applicants.filter((a) => a.status === statusFilter) : applicants;
    const dir = sortDirection === 'asc' ? 1 : -1;
    return filtered.slice().sort((a, b) =>
      (sortField === 'status' ? a.status.localeCompare(b.status) : `${a.last_name}, ${a.first_name}`.localeCompare(`${b.last_name}, ${b.first_name}`)) * dir,
    );
  }, [applicants, statusFilter, sortField, sortDirection]);

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading applicants" rows={4} />
      </Card>
    );
  }

  return (
    <div>
      {canManage && (
        <div style={{ marginBottom: 'var(--pb-space-3)' }}>
          <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Cancel' : 'New applicant'}
          </Button>
        </div>
      )}

      {showCreate && (
        <Card style={{ padding: 'var(--pb-space-4)', marginBottom: 'var(--pb-space-3)' }}>
          <div className={styles.formRow}>
            <select className={styles.select} value={form.schoolId} onChange={(e) => setForm({ ...form, schoolId: e.target.value })}>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input className={styles.textInput} placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            <input className={styles.textInput} placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <div className={styles.formRow}>
            <input className={styles.textInput} type="date" aria-label="Date of birth" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
            <input className={styles.textInput} placeholder="Gender (optional)" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} />
            <input className={styles.textInput} placeholder="Previous school (optional)" value={form.previousSchool} onChange={(e) => setForm({ ...form, previousSchool: e.target.value })} />
          </div>
          {createError && <ErrorState message={createError} />}
          <Button type="button" onClick={handleCreate} disabled={saving || !form.schoolId || !form.firstName || !form.lastName}>
            Save applicant
          </Button>
        </Card>
      )}

      <Card style={{ padding: 'var(--pb-space-4)' }}>
        <div className={styles.formRow}>
          <select className={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
          <SortDropdown
            options={[
              { value: 'name', label: 'Name' },
              { value: 'status', label: 'Status' },
            ]}
            value={sortField}
            direction={sortDirection}
            onChange={(v, d) => {
              setSortField(v as 'name' | 'status');
              setSortDirection(d);
            }}
          />
        </div>

        {visible.length === 0 ? (
          <EmptyState title="No applicants" message="Add one above to get started." />
        ) : (
          visible.map((a) => (
            <div key={a.id}>
              <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}>
                <span>
                  {a.last_name}, {a.first_name}
                  {a.admission_no && <> · {a.admission_no}</>}
                </span>
                <Pill variant={STATUS_VARIANT[a.status] ?? 'neutral'}>{a.status.replace('_', ' ')}</Pill>
              </div>
              {expandedId === a.id && (
                <ApplicantDetail applicant={a} years={years} classes={classes} canManage={canManage} onChanged={reload} />
              )}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

function ApplicantDetail({
  applicant,
  years,
  classes,
  canManage,
  onChanged,
}: {
  applicant: Applicant;
  years: AcademicYear[];
  classes: SchoolClass[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [nextStatus, setNextStatus] = useState(applicant.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [convertForm, setConvertForm] = useState({ academicYearId: years[0]?.id ?? '', classId: classes[0]?.id ?? '' });
  const [showIntake, setShowIntake] = useState(false);

  if (!canManage) {
    return <RestrictedState message="Managing admissions requires an admissions-office or leadership role." />;
  }

  async function saveStatus() {
    if (nextStatus === applicant.status) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/admissions/${applicant.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    onChanged();
  }

  async function convert() {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/admissions/${applicant.id}/convert`, { method: 'POST', body: JSON.stringify(convertForm) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    onChanged();
  }

  return (
    <Card style={{ padding: 'var(--pb-space-4)', margin: 'var(--pb-space-2) 0 var(--pb-space-3)' }}>
      {applicant.dob && <p className={styles.hint}>Born {new Date(applicant.dob).toLocaleDateString()}</p>}
      {applicant.previous_school && <p className={styles.hint}>Previously at {applicant.previous_school}</p>}

      {applicant.status === 'admitted' || applicant.student_id ? (
        <p className={styles.hint}>Already converted — admission no. {applicant.admission_no}.</p>
      ) : (
        <>
          <div className={styles.formRow}>
            <select className={styles.select} value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
            <Button type="button" onClick={saveStatus} disabled={busy || nextStatus === applicant.status}>
              Update status
            </Button>
          </div>

          {applicant.status === 'approved' && (
            <div className={styles.formRow}>
              <select className={styles.select} value={convertForm.academicYearId} onChange={(e) => setConvertForm({ ...convertForm, academicYearId: e.target.value })}>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </select>
              <select className={styles.select} value={convertForm.classId} onChange={(e) => setConvertForm({ ...convertForm, classId: e.target.value })}>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Button type="button" onClick={convert} disabled={busy || !convertForm.academicYearId || !convertForm.classId}>
                Convert to student
              </Button>
            </div>
          )}
        </>
      )}
      {error && <ErrorState message={error} />}

      <div style={{ marginTop: 'var(--pb-space-3)' }}>
        <Button type="button" variant="secondary" onClick={() => setShowIntake((v) => !v)}>
          {showIntake ? 'Hide intake details' : 'Intake details (guardians, medical, documents, interview)'}
        </Button>
        {showIntake && <IntakeForm applicant={applicant} onChanged={onChanged} />}
      </div>
    </Card>
  );
}

/**
 * FR-ADM-010's full intake surface — see 0042_admissions_intake.sql's
 * header for why this is progressive (PATCH .../intake), not part of the
 * initial create() form. No object storage exists anywhere in this
 * codebase (see the root README's "what's actually here" table), so
 * "photo" is an external URL reference and "supporting documents" is a
 * received/not-received checklist, not a real upload.
 */
function IntakeForm({ applicant, onChanged }: { applicant: Applicant; onChanged: () => void }) {
  const [form, setForm] = useState({
    photoUrl: applicant.photo_url ?? '',
    nationality: applicant.nationality ?? '',
    homeLanguage: applicant.home_language ?? '',
    address: applicant.address ?? '',
    guardianName: applicant.guardian_name ?? '',
    guardianPhone: applicant.guardian_phone ?? '',
    guardianEmail: applicant.guardian_email ?? '',
    guardianRelationship: applicant.guardian_relationship ?? '',
    emergencyContactName: applicant.emergency_contact_name ?? '',
    emergencyContactPhone: applicant.emergency_contact_phone ?? '',
    medicalNotes: applicant.medical_notes ?? '',
    learningSupportNotes: applicant.learning_support_notes ?? '',
    interviewDate: applicant.interview_date ? applicant.interview_date.slice(0, 10) : '',
    interviewNotes: applicant.interview_notes ?? '',
    assessmentNotes: applicant.assessment_notes ?? '',
  });
  const [documents, setDocuments] = useState<DocumentChecklistItem[]>(applicant.documents_checklist ?? []);
  const [newDocName, setNewDocName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function addDocument() {
    if (!newDocName.trim()) return;
    setDocuments((docs) => [...docs, { name: newDocName.trim(), received: false }]);
    setNewDocName('');
  }

  function toggleDocument(index: number) {
    setDocuments((docs) => docs.map((d, i) => (i === index ? { ...d, received: !d.received } : d)));
  }

  function removeDocument(index: number) {
    setDocuments((docs) => docs.filter((_, i) => i !== index));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await apiFetch(`/v1/admissions/${applicant.id}/intake`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || undefined])),
          documentsChecklist: documents,
        }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save intake details.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 'var(--pb-space-3)' }}>
      <p className={styles.hint} style={{ marginBottom: 'var(--pb-space-2)' }}>
        Identity &amp; background
      </p>
      <div className={styles.formRow}>
        <input className={styles.textInput} placeholder="Photo URL (optional)" value={form.photoUrl} onChange={(e) => setForm({ ...form, photoUrl: e.target.value })} />
        <input className={styles.textInput} placeholder="Nationality" value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} />
        <input className={styles.textInput} placeholder="Home language" value={form.homeLanguage} onChange={(e) => setForm({ ...form, homeLanguage: e.target.value })} />
      </div>
      <div className={styles.formRow}>
        <input className={styles.textInput} placeholder="Home address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} style={{ flex: 1 }} />
      </div>

      <p className={styles.hint} style={{ margin: 'var(--pb-space-3) 0 var(--pb-space-2)' }}>
        Guardian contact
      </p>
      <div className={styles.formRow}>
        <input className={styles.textInput} placeholder="Guardian full name" value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} />
        <input className={styles.textInput} placeholder="Relationship (e.g. mother)" value={form.guardianRelationship} onChange={(e) => setForm({ ...form, guardianRelationship: e.target.value })} />
      </div>
      <div className={styles.formRow}>
        <input className={styles.textInput} placeholder="Guardian phone" value={form.guardianPhone} onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })} />
        <input className={styles.textInput} placeholder="Guardian email" value={form.guardianEmail} onChange={(e) => setForm({ ...form, guardianEmail: e.target.value })} />
      </div>

      <p className={styles.hint} style={{ margin: 'var(--pb-space-3) 0 var(--pb-space-2)' }}>
        Emergency contact
      </p>
      <div className={styles.formRow}>
        <input className={styles.textInput} placeholder="Emergency contact name" value={form.emergencyContactName} onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })} />
        <input className={styles.textInput} placeholder="Emergency contact phone" value={form.emergencyContactPhone} onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })} />
      </div>

      <p className={styles.hint} style={{ margin: 'var(--pb-space-3) 0 var(--pb-space-2)' }}>
        Medical &amp; learning support
      </p>
      <div className={styles.formRow}>
        <textarea className={styles.textArea} placeholder="Medical notes (allergies, conditions, medication)" value={form.medicalNotes} onChange={(e) => setForm({ ...form, medicalNotes: e.target.value })} />
        <textarea className={styles.textArea} placeholder="Learning-support needs" value={form.learningSupportNotes} onChange={(e) => setForm({ ...form, learningSupportNotes: e.target.value })} />
      </div>

      <p className={styles.hint} style={{ margin: 'var(--pb-space-3) 0 var(--pb-space-2)' }}>
        Interview / entrance assessment
      </p>
      <div className={styles.formRow}>
        <input className={styles.textInput} type="date" aria-label="Interview date" value={form.interviewDate} onChange={(e) => setForm({ ...form, interviewDate: e.target.value })} />
      </div>
      <div className={styles.formRow}>
        <textarea className={styles.textArea} placeholder="Interview notes" value={form.interviewNotes} onChange={(e) => setForm({ ...form, interviewNotes: e.target.value })} />
        <textarea className={styles.textArea} placeholder="Entrance assessment notes" value={form.assessmentNotes} onChange={(e) => setForm({ ...form, assessmentNotes: e.target.value })} />
      </div>

      <p className={styles.hint} style={{ margin: 'var(--pb-space-3) 0 var(--pb-space-2)' }}>
        Supporting documents — tracked here, not uploaded (no file storage in this build)
      </p>
      {documents.map((d, i) => (
        <div key={`${d.name}-${i}`} className={styles.listRow}>
          <label className={styles.checklistItem}>
            <input type="checkbox" checked={d.received} onChange={() => toggleDocument(i)} /> {d.name}
          </label>
          <Button type="button" variant="secondary" onClick={() => removeDocument(i)}>
            Remove
          </Button>
        </div>
      ))}
      <div className={styles.formRow}>
        <input className={styles.textInput} placeholder="Document name (e.g. Birth certificate)" value={newDocName} onChange={(e) => setNewDocName(e.target.value)} />
        <Button type="button" variant="secondary" onClick={addDocument} disabled={!newDocName.trim()}>
          Add document
        </Button>
      </div>

      {error && <ErrorState message={error} />}
      <Button type="button" onClick={save} disabled={saving} style={{ marginTop: 'var(--pb-space-3)' }}>
        Save intake details
      </Button>
      {saved && <span className={styles.hint} style={{ marginLeft: 'var(--pb-space-2)' }}>Saved.</span>}
    </div>
  );
}
