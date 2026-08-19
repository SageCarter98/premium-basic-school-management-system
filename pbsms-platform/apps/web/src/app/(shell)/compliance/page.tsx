'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { RestrictedState } from '@/components/states/RestrictedState';
import { apiFetch, apiGet } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { ACADEMIC_STAFF, LEADERSHIP, hasAnyRole } from '@/lib/role-groups';
import styles from '@/styles/tab-hub.module.css';

interface Student {
  id: string;
  first_name: string;
  last_name: string;
}
interface Guardian {
  id: string;
  full_name: string;
}
interface StaffMember {
  id: string;
  full_name: string;
}
interface DataInventoryEntry {
  id: string;
  data_category: string;
  description: string;
  lawful_basis: string;
  sensitivity_classification: string;
  source_tables: string[];
}
interface AuditLogEntry {
  id: string;
  actor_user_id: string;
  actor_role_codes: string[];
  action: string;
  method: string;
  path: string;
  status_code: number;
  created_at: string;
}
interface RetentionPolicy {
  id: string;
  record_type: string;
  retention_description: string;
  retention_years: string | null;
  basis: string;
}
interface RetentionEligibilityRow {
  recordType: string;
  eligibleCount: number;
  oldestDate: string | null;
}
interface DataSubjectRequest {
  id: string;
  request_type: string;
  subject_type: string;
  subject_id: string;
  requester_name: string;
  requester_contact: string | null;
  assigned_to: string | null;
  status: string;
  due_date: string;
  fulfilled_at: string | null;
  fulfillment_notes: string | null;
  rejection_reason: string | null;
}
interface ConsentRecord {
  id: string;
  subject_type: string;
  subject_id: string;
  consent_type: string;
  channel: string | null;
  granted: boolean;
  version: number;
  recorded_at: string;
  withdrawn_at: string | null;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = body?.message;
  return (Array.isArray(m) ? m.join('; ') : m) ?? fallback;
}

function studentName(students: Student[], id: string): string {
  const s = students.find((st) => st.id === id);
  return s ? `${s.last_name}, ${s.first_name}` : id.slice(0, 8) + '…';
}

const DSR_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  received: 'warning',
  in_progress: 'warning',
  fulfilled: 'success',
  rejected: 'danger',
};

const TABS = ['Data Subject Requests', 'Consent', 'Data Inventory', 'Retention', 'Audit Log'] as const;
type Tab = (typeof TABS)[number];

/**
 * SRS §7.14 "Compliance & Curriculum" (Volume V, DP-030/090). One spec
 * item genuinely not built here, flagged not faked: retention is
 * reporting-only — there is no purge mechanism anywhere, so the
 * Retention tab can only ever show counts, never a "purge now" action.
 * The audit log viewer (tenant-visible only, not platform actions —
 * those live in a separate table this tenant role has no grant on)
 * closes what was previously flagged as a missing read endpoint; see
 * apps/web/README.md's post-Stage-9 gap closure section.
 */
export default function CompliancePage() {
  const [tab, setTab] = useState<Tab>('Data Subject Requests');
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canAccess = hasAnyRole(roleCodes, ACADEMIC_STAFF);
  const canManageRequests = hasAnyRole(roleCodes, LEADERSHIP);

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    Promise.all([apiGet<Student[]>('/v1/students'), apiGet<Guardian[]>('/v1/guardians'), apiGet<StaffMember[]>('/v1/staff')]).then(([s, g, st]) => {
      setStudents(s);
      setGuardians(g);
      setStaff(st);
      setLoading(false);
    });
  }, [canAccess]);

  if (!canAccess) {
    return (
      <Card>
        <RestrictedState message="Compliance is available to teaching and administrative staff." />
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading compliance" rows={4} />
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
      <Card style={{ padding: 'var(--pb-space-4)' }}>
        {tab === 'Data Subject Requests' && <DsrTab students={students} guardians={guardians} staff={staff} canManage={canManageRequests} />}
        {tab === 'Consent' && <ConsentTab students={students} guardians={guardians} staff={staff} />}
        {tab === 'Data Inventory' && <DataInventoryTab />}
        {tab === 'Retention' && <RetentionTab canManage={canManageRequests} />}
        {tab === 'Audit Log' && <AuditLogTab staff={staff} canManage={canManageRequests} />}
      </Card>
    </div>
  );
}

function subjectLabel(students: Student[], guardians: Guardian[], staff: StaffMember[], type: string, id: string): string {
  if (type === 'student') return studentName(students, id);
  if (type === 'guardian') return guardians.find((g) => g.id === id)?.full_name ?? id.slice(0, 8) + '…';
  return staff.find((s) => s.id === id)?.full_name ?? id.slice(0, 8) + '…';
}

function DsrTab({ students, guardians, staff, canManage }: { students: Student[]; guardians: Guardian[]; staff: StaffMember[]; canManage: boolean }) {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<DataSubjectRequest[]>([]);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ requestType: 'access', subjectType: 'guardian' as 'student' | 'staff' | 'guardian', subjectId: '', requesterName: '', requesterContact: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    const path = overdueOnly ? '/v1/data-protection/requests/overdue' : '/v1/data-protection/requests';
    apiGet<DataSubjectRequest[]>(path)
      .then(setRequests)
      .finally(() => setLoading(false));
  }
  useEffect(reload, [overdueOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  function subjectOptions() {
    if (form.subjectType === 'student') return students.map((s) => ({ id: s.id, label: `${s.last_name}, ${s.first_name}` }));
    if (form.subjectType === 'staff') return staff.map((s) => ({ id: s.id, label: s.full_name }));
    return guardians.map((g) => ({ id: g.id, label: g.full_name }));
  }

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/v1/data-protection/requests', {
        method: 'POST',
        body: JSON.stringify({ ...form, requesterContact: form.requesterContact || undefined }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm((f) => ({ ...f, subjectId: '', requesterName: '', requesterContact: '' }));
      setShowCreate(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log request.');
    } finally {
      setSaving(false);
    }
  }

  async function assign(id: string) {
    const assigneeUserId = window.prompt('Staff id to assign this request to:');
    if (!assigneeUserId) return;
    setError(null);
    const res = await apiFetch(`/v1/data-protection/requests/${id}/assign`, { method: 'POST', body: JSON.stringify({ assigneeUserId }) });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
  }

  async function fulfill(id: string) {
    const fulfillmentNotes = window.prompt('Fulfillment notes (required):');
    if (!fulfillmentNotes) return;
    setError(null);
    const res = await apiFetch(`/v1/data-protection/requests/${id}/fulfill`, { method: 'POST', body: JSON.stringify({ fulfillmentNotes }) });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
  }

  async function reject(id: string) {
    const rejectionReason = window.prompt('Rejection reason (required):');
    if (!rejectionReason) return;
    setError(null);
    const res = await apiFetch(`/v1/data-protection/requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ rejectionReason }) });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
  }

  const isOverdue = (r: DataSubjectRequest) => ['received', 'in_progress'].includes(r.status) && r.due_date < new Date().toISOString();

  if (loading) return <LoadingState label="Loading data subject requests" rows={3} />;

  return (
    <div>
      <p className={styles.hint}>Every request gets a 30-day SLA due date, set server-side.</p>
      <div className={styles.formRow}>
        <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancel' : 'Log request'}
        </Button>
        <label className={styles.checklistItem}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
        </label>
      </div>
      {showCreate && (
        <div style={{ marginBottom: 'var(--pb-space-3)' }}>
          <div className={styles.formRow}>
            <select className={styles.select} value={form.requestType} onChange={(e) => setForm({ ...form, requestType: e.target.value })}>
              <option value="access">Access</option>
              <option value="rectification">Rectification</option>
              <option value="erasure">Erasure</option>
            </select>
            <select className={styles.select} value={form.subjectType} onChange={(e) => setForm({ ...form, subjectType: e.target.value as 'student' | 'staff' | 'guardian', subjectId: '' })}>
              <option value="guardian">Guardian</option>
              <option value="student">Student</option>
              <option value="staff">Staff</option>
            </select>
            <select className={styles.select} value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
              <option value="">Choose the subject</option>
              {subjectOptions().map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.formRow}>
            <input className={styles.textInput} placeholder="Requester name" value={form.requesterName} onChange={(e) => setForm({ ...form, requesterName: e.target.value })} />
            <input className={styles.textInput} placeholder="Requester contact (optional)" value={form.requesterContact} onChange={(e) => setForm({ ...form, requesterContact: e.target.value })} />
          </div>
          <Button type="button" onClick={create} disabled={saving || !form.subjectId || !form.requesterName}>
            Save
          </Button>
        </div>
      )}
      {error && <ErrorState message={error} />}
      {requests.length === 0 ? (
        <EmptyState title="No requests" message={overdueOnly ? 'Nothing overdue right now.' : 'Log a data subject request above.'} />
      ) : (
        requests.map((r) => (
          <div key={r.id} className={styles.listRow}>
            <span>
              {r.request_type} — {subjectLabel(students, guardians, staff, r.subject_type, r.subject_id)} · requested by {r.requester_name}
              {r.status === 'rejected' && r.rejection_reason && <> — {r.rejection_reason}</>}
              {r.status === 'fulfilled' && r.fulfillment_notes && <> — {r.fulfillment_notes}</>}
            </span>
            <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
              {isOverdue(r) && <Pill variant="danger">overdue</Pill>}
              <Pill variant={DSR_STATUS_VARIANT[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Pill>
              <span className={styles.hint}>due {new Date(r.due_date).toLocaleDateString()}</span>
              {canManage && ['received', 'in_progress'].includes(r.status) && (
                <>
                  <Button type="button" variant="secondary" onClick={() => assign(r.id)}>
                    Assign
                  </Button>
                  <Button type="button" onClick={() => fulfill(r.id)}>
                    Fulfil
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => reject(r.id)}>
                    Reject
                  </Button>
                </>
              )}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function ConsentTab({ students, guardians, staff }: { students: Student[]; guardians: Guardian[]; staff: StaffMember[] }) {
  const [subjectType, setSubjectType] = useState<'student' | 'staff' | 'guardian'>('guardian');
  const [subjectId, setSubjectId] = useState('');
  const [records, setRecords] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ consentType: 'communication_channel' as 'communication_channel' | 'biometric', channel: 'email', granted: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function subjectOptions() {
    if (subjectType === 'student') return students.map((s) => ({ id: s.id, label: `${s.last_name}, ${s.first_name}` }));
    if (subjectType === 'staff') return staff.map((s) => ({ id: s.id, label: s.full_name }));
    return guardians.map((g) => ({ id: g.id, label: g.full_name }));
  }

  async function load(id: string) {
    if (!id) return;
    setLoading(true);
    setRecords(await apiGet<ConsentRecord[]>(`/v1/data-protection/consent/${subjectType}/${id}`));
    setLoading(false);
  }

  async function record() {
    setBusy(true);
    setError(null);
    const res = await apiFetch('/v1/data-protection/consent', {
      method: 'POST',
      body: JSON.stringify({ subjectType, subjectId, consentType: form.consentType, channel: form.consentType === 'communication_channel' ? form.channel : undefined, granted: form.granted }),
    });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    load(subjectId);
  }

  return (
    <div>
      <p className={styles.hint}>
        This is the compliance-of-record consent registry (DP-030) — versioned, covers both communication-channel and biometric consent. Recording a communication-channel consent also
        updates the operational send-gate the Communication module reads from.
      </p>
      <div className={styles.formRow}>
        <select className={styles.select} value={subjectType} onChange={(e) => { setSubjectType(e.target.value as 'student' | 'staff' | 'guardian'); setSubjectId(''); setRecords([]); }}>
          <option value="guardian">Guardian</option>
          <option value="student">Student</option>
          <option value="staff">Staff</option>
        </select>
        <select className={styles.select} value={subjectId} onChange={(e) => { setSubjectId(e.target.value); load(e.target.value); }}>
          <option value="">Choose a subject</option>
          {subjectOptions().map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {subjectId && (
        <>
          <div className={styles.formRow}>
            <select className={styles.select} value={form.consentType} onChange={(e) => setForm({ ...form, consentType: e.target.value as 'communication_channel' | 'biometric' })}>
              <option value="communication_channel">Communication channel</option>
              <option value="biometric">Biometric</option>
            </select>
            {form.consentType === 'communication_channel' && (
              <select className={styles.select} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                <option value="whatsapp">whatsapp</option>
                <option value="sms">sms</option>
                <option value="email">email</option>
              </select>
            )}
            <select className={styles.select} value={form.granted ? 'granted' : 'withdrawn'} onChange={(e) => setForm({ ...form, granted: e.target.value === 'granted' })}>
              <option value="granted">Granted</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
            <Button type="button" onClick={record} disabled={busy}>
              Record
            </Button>
          </div>
          {error && <ErrorState message={error} />}
          {loading ? (
            <LoadingState label="Loading consent" rows={2} />
          ) : records.length === 0 ? (
            <EmptyState title="No consent recorded yet" message="Record the current state above." />
          ) : (
            records.map((r) => (
              <div key={r.id} className={styles.listRow}>
                <span>
                  {r.consent_type.replace('_', ' ')}
                  {r.channel && <> · {r.channel}</>} — v{r.version}
                </span>
                <Pill variant={r.granted ? 'success' : 'danger'}>{r.granted ? 'granted' : 'withdrawn'}</Pill>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}

function DataInventoryTab() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<DataInventoryEntry[]>([]);

  useEffect(() => {
    apiGet<DataInventoryEntry[]>('/v1/data-protection/inventory')
      .then(setEntries)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState label="Loading the data inventory" rows={3} />;

  return (
    <div>
      <p className={styles.hint}>
        Static reference data (DP-090) — what personal data this system holds, its lawful basis and sensitivity classification. A tenant-visible audit log viewer (the spec&apos;s other
        §7.14 screen) is not built: no endpoint anywhere in this backend exposes the audit_log table for reading.
      </p>
      {entries.length === 0 ? (
        <EmptyState title="No data inventory entries" message="None configured." />
      ) : (
        entries.map((e) => (
          <div key={e.id} className={styles.listRow}>
            <span>
              {e.data_category} — {e.description}
            </span>
            <span style={{ display: 'flex', gap: 'var(--pb-space-2)' }}>
              <Pill variant="neutral">{e.lawful_basis}</Pill>
              <Pill variant={e.sensitivity_classification === 'confidential' ? 'danger' : 'neutral'}>{e.sensitivity_classification}</Pill>
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function RetentionTab({ canManage }: { canManage: boolean }) {
  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [eligibility, setEligibility] = useState<RetentionEligibilityRow[]>([]);

  useEffect(() => {
    apiGet<RetentionPolicy[]>('/v1/data-protection/retention-policies')
      .then(setPolicies)
      .then(() => (canManage ? apiGet<RetentionEligibilityRow[]>('/v1/data-protection/retention-eligibility-report') : Promise.resolve([])))
      .then(setEligibility)
      .finally(() => setLoading(false));
  }, [canManage]);

  if (loading) return <LoadingState label="Loading retention policies" rows={3} />;

  return (
    <div>
      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Policies</div>
        {policies.map((p) => (
          <div key={p.id} className={styles.listRow}>
            <span>
              {p.record_type} — {p.retention_description}
            </span>
            <span className={styles.hint}>{p.retention_years ? `${p.retention_years}y` : '—'} · {p.basis}</span>
          </div>
        ))}
      </div>
      {canManage && (
        <div className={styles.detailSection}>
          <div className={styles.detailSectionTitle}>Eligibility report</div>
          <p className={styles.hint}>
            Reporting-only — only 2 of the real policies are computable today (attendance post-graduation, financial-transaction age); the rest need a reliable enrolment exit date this
            schema doesn&apos;t track yet. There is no automated purge anywhere in this system — this counts what would be eligible, it does not delete anything.
          </p>
          {eligibility.length === 0 ? (
            <EmptyState title="Nothing eligible" message="No records currently meet a computable retention policy." />
          ) : (
            eligibility.map((row) => (
              <div key={row.recordType} className={styles.listRow}>
                <span>{row.recordType}</span>
                <span>
                  {row.eligibleCount} eligible{row.oldestDate && <> · oldest {new Date(row.oldestDate).toLocaleDateString()}</>}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function AuditLogTab({ staff, canManage }: { staff: StaffMember[]; canManage: boolean }) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  function reload(actorUserId: string, action: string) {
    setLoading(true);
    const params = new URLSearchParams();
    if (actorUserId) params.set('actorUserId', actorUserId);
    if (action) params.set('action', action);
    const qs = params.toString();
    apiGet<AuditLogEntry[]>(`/v1/data-protection/audit-log${qs ? `?${qs}` : ''}`)
      .then(setEntries)
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    if (canManage) reload('', '');
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  function actorName(id: string) {
    return staff.find((s) => s.id === id)?.full_name ?? id;
  }

  if (!canManage) {
    return <RestrictedState message="The audit log is available to school leadership only." />;
  }
  if (loading) return <LoadingState label="Loading audit log" rows={4} />;

  return (
    <div>
      <p className={styles.hint}>
        This tenant&apos;s own actions only (create/edit/archive against every endpoint), not platform-actor actions taken during a support impersonation session — those are logged separately
        and aren&apos;t readable from this role. Shows the most recent 200 entries.
      </p>
      <div className={styles.formRow}>
        <select
          aria-label="Filter by staff member"
          className={styles.select}
          value={actorFilter}
          onChange={(e) => {
            setActorFilter(e.target.value);
            reload(e.target.value, actionFilter);
          }}
        >
          <option value="">All staff</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by action"
          className={styles.select}
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            reload(actorFilter, e.target.value);
          }}
        >
          <option value="">All actions</option>
          <option value="create">Create</option>
          <option value="edit">Edit</option>
          <option value="archive">Archive</option>
        </select>
      </div>
      {entries.length === 0 ? (
        <EmptyState title="No audit entries" message="Nothing matches this filter." />
      ) : (
        entries.map((e) => (
          <div key={e.id} className={styles.listRow}>
            <span>
              {actorName(e.actor_user_id)} — {e.action} {e.path}
            </span>
            <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
              <Pill variant={e.status_code < 400 ? 'success' : 'danger'}>{e.status_code}</Pill>
              <span className={styles.hint}>{new Date(e.created_at).toLocaleString()}</span>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
