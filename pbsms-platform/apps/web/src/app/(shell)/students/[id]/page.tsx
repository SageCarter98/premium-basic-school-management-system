'use client';

import { use, useEffect, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { apiFetch, apiGet } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { ACADEMIC_ADMIN, hasAnyRole } from '@/lib/role-groups';
import styles from './profile.module.css';

interface Student {
  id: string;
  school_id: string;
  admission_no: string;
  first_name: string;
  last_name: string;
  status: string;
}

interface Enrolment {
  id: string;
  student_id: string;
  academic_year_id: string;
  class_id: string;
  status: string;
  start_date: string;
  end_date: string | null;
}

interface AcademicYear {
  id: string;
  name: string;
}

interface SchoolClass {
  id: string;
  name: string;
}

interface Guardian {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
}

interface StudentGuardianLink {
  id: string;
  guardian_id: string;
  relationship: string | null;
  is_primary_contact: boolean;
  is_emergency_contact: boolean;
  can_pickup: boolean;
  has_report_access: boolean;
  has_finance_access: boolean;
  full_name: string;
  phone: string | null;
  email: string | null;
}

interface StudentResult {
  id: string;
  academic_year_id: string;
  class_id: string;
  status: string;
  average_percentage: string | null;
  subjects_failed_count: number;
  overall_pass: boolean | null;
  published_at: string | null;
}

interface AttendanceRecord {
  id: string;
  student_id: string;
  attendance_date: string;
  status: string;
}

interface GeneratedDocument {
  id: string;
  document_type: string;
  reference_number: string;
  generated_at: string;
  revoked_at: string | null;
}

const TABS = ['Identity', 'Guardians', 'Academics', 'Attendance', 'Documents', 'Finance', 'Health', 'Discipline', 'Timeline'] as const;
type Tab = (typeof TABS)[number];

const STUB_TABS: Partial<Record<Tab, string>> = {
  Finance: 'Invoices, payments and balance — arrives with Stage 7 (Finance console).',
  Health: 'Restricted-access health records — arrives with Stage 8 (Chapter 28 operational screens).',
  Discipline: 'Restricted-access discipline cases — arrives with Stage 8 (Chapter 28 operational screens).',
  Timeline: 'A chronological feed of every significant event for this student — arrives with Stage 8, alongside the audit/compliance screens it naturally groups with.',
};

/**
 * FR-STU-010 student profile shell (spec §7.5). Nine tabs per the spec's
 * own inventory; five are real this stage (Identity, Guardians, Academics,
 * Attendance, Documents) — Finance/Health/Discipline belong to later
 * stages' surfaces (Stage 7/8) and Timeline is a genuinely separate
 * cross-module aggregation feature, so all four render as an honest
 * EmptyState naming which stage owns them rather than a broken link or a
 * silently-missing tab.
 */
export default function StudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canEdit = hasAnyRole(roleCodes, ACADEMIC_ADMIN);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [tab, setTab] = useState<Tab>('Identity');

  useEffect(() => {
    let cancelled = false;
    apiGet<Student>(`/v1/students/${id}`)
      .then((s) => {
        if (!cancelled) setStudent(s);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this student.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading student" rows={4} />
      </Card>
    );
  }

  if (error || !student) {
    return (
      <Card>
        <ErrorState message={error ?? 'Student not found.'} />
      </Card>
    );
  }

  return (
    <div>
      <div className={styles.header}>
        <div>
          <div className={styles.studentName}>
            {student.last_name}, {student.first_name}
          </div>
          <div className={styles.studentMeta}>{student.admission_no}</div>
        </div>
        <Pill variant={student.status === 'active' ? 'success' : 'neutral'}>{student.status}</Pill>
      </div>

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
        {tab === 'Identity' && <IdentityTab studentId={id} canEdit={canEdit} />}
        {tab === 'Guardians' && <GuardiansTab studentId={id} canEdit={canEdit} />}
        {tab === 'Academics' && <AcademicsTab studentId={id} />}
        {tab === 'Attendance' && <AttendanceTab studentId={id} />}
        {tab === 'Documents' && <DocumentsTab studentId={id} />}
        {STUB_TABS[tab] && <EmptyState title={`${tab} — not in this stage`} message={STUB_TABS[tab]} />}
      </Card>
    </div>
  );
}

function IdentityTab({ studentId, canEdit }: { studentId: string; canEdit: boolean }) {
  const [loading, setLoading] = useState(true);
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiGet<Enrolment[]>('/v1/enrolments'), apiGet<AcademicYear[]>('/v1/academic-years'), apiGet<SchoolClass[]>('/v1/classes')])
      .then(([e, y, c]) => {
        if (cancelled) return;
        setEnrolments(e.filter((row) => row.student_id === studentId));
        setYears(y);
        setClasses(c);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (loading) return <LoadingState label="Loading enrolment history" rows={3} />;

  return (
    <div>
      <p style={{ fontWeight: 600, marginBottom: 'var(--pb-space-2)' }}>Enrolment history</p>
      {enrolments.length === 0 ? (
        <EmptyState title="No enrolment history" message="This student has never been enrolled in a class." />
      ) : (
        enrolments.map((e) => (
          <div key={e.id} className={styles.listRow}>
            <span>
              {years.find((y) => y.id === e.academic_year_id)?.name ?? e.academic_year_id} —{' '}
              {classes.find((c) => c.id === e.class_id)?.name ?? e.class_id}
            </span>
            <Pill variant={e.status === 'active' ? 'success' : 'neutral'}>{e.status}</Pill>
          </div>
        ))
      )}
      {!canEdit && (
        <p style={{ marginTop: 'var(--pb-space-4)', color: 'var(--pb-ink-muted)', fontSize: 'var(--pb-text-small)' }}>
          Editing enrolment requires an academic-office role.
        </p>
      )}
    </div>
  );
}

function GuardiansTab({ studentId, canEdit }: { studentId: string; canEdit: boolean }) {
  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState<StudentGuardianLink[]>([]);
  const [allGuardians, setAllGuardians] = useState<Guardian[]>([]);
  const [showLink, setShowLink] = useState(false);
  const [selectedGuardianId, setSelectedGuardianId] = useState('');
  const [relationship, setRelationship] = useState('');
  const [flags, setFlags] = useState({ isPrimaryContact: false, isEmergencyContact: false, canPickup: false, hasFinanceAccess: false, hasReportAccess: false });
  const [expandedGuardianId, setExpandedGuardianId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    Promise.all([apiGet<StudentGuardianLink[]>(`/v1/students/${studentId}/guardians`), apiGet<Guardian[]>('/v1/guardians')])
      .then(([l, g]) => {
        setLinks(l);
        setAllGuardians(g);
      })
      .finally(() => setLoading(false));
  }

  useEffect(reload, [studentId]);

  async function handleLink() {
    if (!selectedGuardianId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch(`/v1/students/${studentId}/guardians`, {
        method: 'POST',
        body: JSON.stringify({ guardianId: selectedGuardianId, relationship: relationship || undefined, ...flags }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Could not link guardian (${res.status})`);
      }
      setShowLink(false);
      setSelectedGuardianId('');
      setRelationship('');
      setFlags({ isPrimaryContact: false, isEmergencyContact: false, canPickup: false, hasFinanceAccess: false, hasReportAccess: false });
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not link guardian.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading guardians" rows={2} />;

  const linkedIds = new Set(links.map((l) => l.guardian_id));
  const availableGuardians = allGuardians.filter((g) => !linkedIds.has(g.id));

  return (
    <div>
      {links.length === 0 ? (
        <EmptyState title="No guardians linked" message="Link an existing guardian record to this student." />
      ) : (
        links.map((l) => (
          <div key={l.id}>
            <div className={styles.listRow}>
              <span>
                {l.full_name} {l.relationship ? `(${l.relationship})` : ''} — {l.phone ?? l.email ?? 'no contact on file'}
              </span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                {l.is_primary_contact && <Pill variant="gold">Primary</Pill>}
                {l.is_emergency_contact && <Pill variant="warning">Emergency</Pill>}
                {l.can_pickup && <Pill variant="neutral">Pickup</Pill>}
                {canEdit && (
                  <Button type="button" variant="secondary" onClick={() => setExpandedGuardianId((v) => (v === l.guardian_id ? null : l.guardian_id))}>
                    Parent access
                  </Button>
                )}
              </span>
            </div>
            {expandedGuardianId === l.guardian_id && (
              <GuardianAccessPanel
                guardianId={l.guardian_id}
                reportAccessGranted={l.has_report_access}
                financeAccessGranted={l.has_finance_access}
              />
            )}
          </div>
        ))
      )}

      {canEdit && (
        <div style={{ marginTop: 'var(--pb-space-4)' }}>
          <Button type="button" variant="secondary" onClick={() => setShowLink((v) => !v)}>
            {showLink ? 'Cancel' : 'Link a guardian'}
          </Button>
          {showLink && (
            <div style={{ marginTop: 'var(--pb-space-3)' }}>
              <div className={styles.formRow}>
                <select className={styles.select} value={selectedGuardianId} onChange={(e) => setSelectedGuardianId(e.target.value)}>
                  <option value="">Select a guardian…</option>
                  {availableGuardians.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.full_name}
                    </option>
                  ))}
                </select>
                <input
                  className={styles.textInput}
                  placeholder="Relationship (e.g. mother, father)"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                />
              </div>
              <div className={styles.formRow}>
                <label className={styles.checkboxRow}>
                  <input type="checkbox" checked={flags.isPrimaryContact} onChange={(e) => setFlags({ ...flags, isPrimaryContact: e.target.checked })} />
                  Primary contact
                </label>
                <label className={styles.checkboxRow}>
                  <input type="checkbox" checked={flags.isEmergencyContact} onChange={(e) => setFlags({ ...flags, isEmergencyContact: e.target.checked })} />
                  Emergency contact
                </label>
                <label className={styles.checkboxRow}>
                  <input type="checkbox" checked={flags.canPickup} onChange={(e) => setFlags({ ...flags, canPickup: e.target.checked })} />
                  Can pick up
                </label>
                <label className={styles.checkboxRow}>
                  <input type="checkbox" checked={flags.hasReportAccess} onChange={(e) => setFlags({ ...flags, hasReportAccess: e.target.checked })} />
                  Can see results (Parent View)
                </label>
                <label className={styles.checkboxRow}>
                  <input type="checkbox" checked={flags.hasFinanceAccess} onChange={(e) => setFlags({ ...flags, hasFinanceAccess: e.target.checked })} />
                  Can see balance (Parent View)
                </label>
              </div>
              {saveError && <ErrorState message={saveError} />}
              <Button type="button" onClick={handleLink} disabled={saving || !selectedGuardianId}>
                Save link
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface GuardianAccessGrant {
  id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

/**
 * Stage 6 (Parent View) — staff-side link management, reachable from a
 * guardian's row on this tab. A newly-created link's raw token is shown
 * exactly once (the backend never returns it again — only its hash is
 * persisted, see guardians.service.ts's createAccessGrant()), so the
 * generated URL stays visible in this panel's own state until the staff
 * member copies it or navigates away, not re-fetchable afterward.
 */
function GuardianAccessPanel({
  guardianId,
  reportAccessGranted,
  financeAccessGranted,
}: {
  guardianId: string;
  reportAccessGranted: boolean;
  financeAccessGranted: boolean;
}) {
  const [grants, setGrants] = useState<GuardianAccessGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<GuardianAccessGrant[]>(`/v1/guardians/${guardianId}/access-links`)
      .then(setGrants)
      .finally(() => setLoading(false));
  }
  useEffect(reload, [guardianId]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await apiFetch(`/v1/guardians/${guardianId}/access-links`, { method: 'POST', body: JSON.stringify({}) });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      const body = (await res.json()) as { token: string };
      setNewLink(`${window.location.origin}/parent?token=${body.token}`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate a link.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke(id: string) {
    await apiFetch(`/v1/guardian-access-links/${id}/revoke`, { method: 'POST' });
    reload();
  }

  return (
    <Card style={{ padding: 'var(--pb-space-4)', margin: 'var(--pb-space-2) 0 var(--pb-space-3)' }}>
      <p style={{ fontSize: 'var(--pb-text-caption)', color: 'var(--pb-ink-muted)', marginBottom: 'var(--pb-space-2)' }}>
        Parent View shows {reportAccessGranted ? 'results' : 'no results (report access off)'} and{' '}
        {financeAccessGranted ? 'balance' : 'no balance (finance access off)'} for this guardian — edit those flags via
        "Link a guardian" above (unlink and relink to change them this stage).
      </p>
      {error && <ErrorState message={error} />}
      {newLink && (
        <div style={{ marginBottom: 'var(--pb-space-3)' }}>
          <p style={{ fontWeight: 600, fontSize: 'var(--pb-text-small)' }}>New link (share this with the guardian directly — it will not be shown again):</p>
          <input readOnly value={newLink} onFocus={(e) => e.target.select()} className={styles.textInput} style={{ width: '100%' }} />
        </div>
      )}
      <Button type="button" onClick={handleGenerate} disabled={generating} style={{ marginBottom: 'var(--pb-space-3)' }}>
        Generate new link
      </Button>
      {!loading &&
        grants.map((g) => (
          <div key={g.id} className={styles.listRow}>
            <span>
              Created {new Date(g.created_at).toLocaleDateString()} — expires {new Date(g.expires_at).toLocaleDateString()}
              {g.last_used_at ? ` — last used ${new Date(g.last_used_at).toLocaleDateString()}` : ' — never used'}
            </span>
            {g.revoked_at ? (
              <Pill variant="danger">Revoked</Pill>
            ) : (
              <Button type="button" variant="secondary" onClick={() => handleRevoke(g.id)}>
                Revoke
              </Button>
            )}
          </div>
        ))}
    </Card>
  );
}

function AcademicsTab({ studentId }: { studentId: string }) {
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<StudentResult[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiGet<StudentResult[]>(`/v1/results/students/${studentId}`)
      .then((r) => {
        if (!cancelled) setResults(r);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (loading) return <LoadingState label="Loading results" rows={2} />;

  if (results.length === 0) {
    return <EmptyState title="No published results" message="Results appear here once published — a draft in progress never shows on this tab (FR-RES-040)." />;
  }

  return (
    <div>
      {results.map((r) => (
        <div key={r.id} className={styles.listRow}>
          <span>
            Average {r.average_percentage ? `${Number(r.average_percentage).toFixed(1)}%` : '—'} · {r.subjects_failed_count} subject(s) failed
          </span>
          <Pill variant={r.overall_pass ? 'success' : 'danger'}>{r.overall_pass ? 'Pass' : 'Fail'}</Pill>
        </div>
      ))}
    </div>
  );
}

function AttendanceTab({ studentId }: { studentId: string }) {
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiGet<AttendanceRecord[]>('/v1/attendance')
      .then((all) => {
        if (!cancelled) setRecords(all.filter((r) => r.student_id === studentId).slice(0, 30));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (loading) return <LoadingState label="Loading attendance" rows={3} />;

  if (records.length === 0) {
    return <EmptyState title="No attendance recorded" message="Marks appear here once a teacher takes the register for this student's class." />;
  }

  return (
    <div>
      <p style={{ color: 'var(--pb-ink-muted)', fontSize: 'var(--pb-text-caption)', marginBottom: 'var(--pb-space-2)' }}>
        Most recent {records.length} record(s) — a full trend view is a separate reporting feature, not built this stage.
      </p>
      {records.map((r) => (
        <div key={r.id} className={styles.listRow}>
          <span>{new Date(r.attendance_date).toLocaleDateString()}</span>
          <Pill variant={r.status === 'present' ? 'success' : r.status === 'absent' ? 'danger' : 'warning'}>{r.status}</Pill>
        </div>
      ))}
    </div>
  );
}

function DocumentsTab({ studentId }: { studentId: string }) {
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<GeneratedDocument[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiGet<GeneratedDocument[]>('/v1/documents')
      .then((all) => {
        if (!cancelled) setDocs(all.filter((d) => (d as unknown as { student_id: string | null }).student_id === studentId));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (loading) return <LoadingState label="Loading documents" rows={2} />;

  if (docs.length === 0) {
    return <EmptyState title="No documents generated" message="Report cards, transcripts and certificates appear here once generated." />;
  }

  return (
    <div>
      {docs.map((d) => (
        <div key={d.id} className={styles.listRow}>
          <span>
            {d.document_type} — {d.reference_number}
          </span>
          <Pill variant={d.revoked_at ? 'danger' : 'success'}>{d.revoked_at ? 'Revoked' : 'Valid'}</Pill>
        </div>
      ))}
    </div>
  );
}
