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
import { HEALTH_TEAM, hasAnyRole } from '@/lib/role-groups';
import styles from '@/styles/tab-hub.module.css';

interface Student {
  id: string;
  first_name: string;
  last_name: string;
}
interface HealthRecord {
  id: string;
  student_id: string;
  blood_group: string | null;
  allergies: string | null;
  conditions: string | null;
  notes: string | null;
}
interface HealthIncident {
  id: string;
  student_id: string;
  incident_date: string;
  description: string;
  severity: string;
  status: string;
  resolved_at: string | null;
  reopened_at: string | null;
}
interface HealthIncidentGuardianContact {
  id: string;
  recipient_type: string;
  recipient_id: string;
  channel: string | null;
  notes: string;
  created_at: string;
}
interface MedicationLogEntry {
  id: string;
  student_id: string;
  medication_name: string;
  dosage: string;
  administered_by: string;
  administered_at: string;
  notes: string | null;
}
interface Guardian {
  id: string;
  full_name: string;
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

const SEVERITIES = ['minor', 'moderate', 'major', 'severe'];
const CHANNELS = ['whatsapp', 'sms', 'email', 'phone_call', 'in_person'];

const TABS = ['Records', 'Incidents', 'Medication Log'] as const;
type Tab = (typeof TABS)[number];

/**
 * SRS Chapter 28 (spec §7.13 "Health — records, incidents, medication
 * log"). Every backend route under /v1/health is HEALTH_TEAM-only —
 * stricter than every other Stage 8 module, which is why this whole page
 * gates on that one tier rather than a broader-read/narrower-write split.
 * The restricted-access message below is the spec's own worked example
 * (line ~1000 of the frontend spec) reused verbatim, not paraphrased.
 */
export default function HealthPage() {
  const [tab, setTab] = useState<Tab>('Records');
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canAccess = hasAnyRole(roleCodes, HEALTH_TEAM);

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [guardians, setGuardians] = useState<Guardian[]>([]);

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    Promise.all([apiGet<Student[]>('/v1/students'), apiGet<Guardian[]>('/v1/guardians')]).then(([s, g]) => {
      setStudents(s);
      setGuardians(g);
      setLoading(false);
    });
  }, [canAccess]);

  if (!canAccess) {
    return (
      <Card>
        <RestrictedState message="Health records are restricted to staff with the Health Officer role. Ask your administrator if you need access." />
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading health" rows={4} />
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
        {tab === 'Records' && <RecordsTab students={students} />}
        {tab === 'Incidents' && <IncidentsTab students={students} guardians={guardians} />}
        {tab === 'Medication Log' && <MedicationLogTab students={students} />}
      </Card>
    </div>
  );
}

function RecordsTab({ students }: { students: Student[] }) {
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');
  const [record, setRecord] = useState<HealthRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ bloodGroup: '', allergies: '', conditions: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(id: string) {
    if (!id) return;
    setLoading(true);
    const r = await apiGet<HealthRecord | null>(`/v1/health/records/by-student/${id}`);
    setRecord(r);
    setForm({ bloodGroup: r?.blood_group ?? '', allergies: r?.allergies ?? '', conditions: r?.conditions ?? '', notes: r?.notes ?? '' });
    setLoading(false);
  }
  useEffect(() => {
    if (studentId) load(studentId);
  }, [studentId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    setError(null);
    const res = await apiFetch('/v1/health/records', {
      method: 'POST',
      body: JSON.stringify({ studentId, bloodGroup: form.bloodGroup || undefined, allergies: form.allergies || undefined, conditions: form.conditions || undefined, notes: form.notes || undefined }),
    });
    setSaving(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    load(studentId);
  }

  return (
    <div>
      <div className={styles.formRow}>
        <select className={styles.select} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.last_name}, {s.first_name}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <LoadingState label="Loading health record" rows={3} />
      ) : (
        <>
          {!record && <p className={styles.hint}>No health record on file yet for this student.</p>}
          <div className={styles.formRow}>
            <input className={styles.textInput} placeholder="Blood group" value={form.bloodGroup} onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })} />
          </div>
          <div className={styles.formRow}>
            <textarea className={styles.textArea} placeholder="Allergies" value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} />
          </div>
          <div className={styles.formRow}>
            <textarea className={styles.textArea} placeholder="Conditions" value={form.conditions} onChange={(e) => setForm({ ...form, conditions: e.target.value })} />
          </div>
          <div className={styles.formRow}>
            <textarea className={styles.textArea} placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {error && <ErrorState message={error} />}
          <Button type="button" onClick={save} disabled={saving}>
            {record ? 'Update record' : 'Create record'}
          </Button>
        </>
      )}
    </div>
  );
}

function IncidentsTab({ students, guardians }: { students: Student[]; guardians: Guardian[] }) {
  const [loading, setLoading] = useState(true);
  const [incidents, setIncidents] = useState<HealthIncident[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ studentId: students[0]?.id ?? '', incidentDate: '', description: '', severity: 'minor' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<HealthIncidentGuardianContact[]>([]);
  const [contactForm, setContactForm] = useState({ guardianId: '', channel: 'phone_call', notes: '' });

  function reload() {
    setLoading(true);
    apiGet<HealthIncident[]>('/v1/health/incidents')
      .then(setIncidents)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/v1/health/incidents', { method: 'POST', body: JSON.stringify({ ...form, incidentDate: form.incidentDate || new Date().toISOString() }) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm((f) => ({ ...f, description: '', incidentDate: '' }));
      setShowCreate(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not report incident.');
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, action: 'resolve' | 'reopen') {
    setError(null);
    const res = await apiFetch(`/v1/health/incidents/${id}/${action}`, { method: 'POST' });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
  }

  async function expand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setContacts(await apiGet<HealthIncidentGuardianContact[]>(`/v1/health/incidents/${id}/guardian-contacts`));
  }

  async function contactGuardian(incidentId: string) {
    const guardian = guardians.find((g) => g.id === contactForm.guardianId);
    if (!guardian) return;
    setError(null);
    const res = await apiFetch(`/v1/health/incidents/${incidentId}/guardian-contacts`, {
      method: 'POST',
      body: JSON.stringify({ recipientType: 'guardian', recipientId: guardian.id, recipientName: guardian.full_name, channel: contactForm.channel, notes: contactForm.notes, contactedBy: guardian.id }),
    });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setContactForm({ guardianId: '', channel: 'phone_call', notes: '' });
    setContacts(await apiGet<HealthIncidentGuardianContact[]>(`/v1/health/incidents/${incidentId}/guardian-contacts`));
  }

  if (loading) return <LoadingState label="Loading incidents" rows={3} />;

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showCreate ? 'Cancel' : 'Report incident'}
      </Button>
      {showCreate && (
        <div style={{ marginBottom: 'var(--pb-space-3)' }}>
          <div className={styles.formRow}>
            <select className={styles.select} value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.last_name}, {s.first_name}
                </option>
              ))}
            </select>
            <select className={styles.select} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.formRow}>
            <textarea className={styles.textArea} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <Button type="button" onClick={create} disabled={saving || !form.description}>
            Save
          </Button>
        </div>
      )}
      {error && <ErrorState message={error} />}
      {incidents.length === 0 ? (
        <EmptyState title="No incidents recorded yet" message="Report one above." />
      ) : (
        incidents.map((i) => (
          <div key={i.id}>
            <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => expand(i.id)}>
              <span>
                {studentName(students, i.student_id)} — {i.description.slice(0, 60)} · {new Date(i.incident_date).toLocaleDateString()}
              </span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                <Pill variant={i.severity === 'severe' || i.severity === 'major' ? 'danger' : 'warning'}>{i.severity}</Pill>
                <Pill variant={i.status === 'resolved' ? 'success' : 'warning'}>{i.status}</Pill>
              </span>
            </div>
            {expandedId === i.id && (
              <div className={styles.detailPanel}>
                <div className={styles.actionRow}>
                  {i.status === 'reported' && (
                    <Button type="button" onClick={() => act(i.id, 'resolve')}>
                      Resolve
                    </Button>
                  )}
                  {i.status === 'resolved' && (
                    <Button type="button" variant="secondary" onClick={() => act(i.id, 'reopen')}>
                      Reopen
                    </Button>
                  )}
                </div>
                <div className={styles.detailSection} style={{ marginTop: 'var(--pb-space-3)' }}>
                  <div className={styles.detailSectionTitle}>Guardian contacts</div>
                  {contacts.length === 0 ? (
                    <p className={styles.hint}>No guardian contacted yet.</p>
                  ) : (
                    contacts.map((c) => (
                      <div key={c.id} className={styles.listRow}>
                        <span>
                          {c.channel ?? 'no channel'} — {c.notes}
                        </span>
                        <span className={styles.hint}>{new Date(c.created_at).toLocaleString()}</span>
                      </div>
                    ))
                  )}
                  <div className={styles.formRow}>
                    <select className={styles.select} value={contactForm.guardianId} onChange={(e) => setContactForm({ ...contactForm, guardianId: e.target.value })}>
                      <option value="">Choose a guardian</option>
                      {guardians.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.full_name}
                        </option>
                      ))}
                    </select>
                    <select className={styles.select} value={contactForm.channel} onChange={(e) => setContactForm({ ...contactForm, channel: e.target.value })}>
                      {CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          {c.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                    <input className={styles.textInput} placeholder="Notes" value={contactForm.notes} onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })} />
                    <Button type="button" variant="secondary" onClick={() => contactGuardian(i.id)} disabled={!contactForm.guardianId || !contactForm.notes}>
                      Log contact
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function MedicationLogTab({ students }: { students: Student[] }) {
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');
  const [entries, setEntries] = useState<MedicationLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ medicationName: '', dosage: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(id: string) {
    if (!id) return;
    setLoading(true);
    setEntries(await apiGet<MedicationLogEntry[]>(`/v1/health/medication-log/by-student/${id}`));
    setLoading(false);
  }
  useEffect(() => {
    if (studentId) load(studentId);
  }, [studentId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function log() {
    const userId = decodeAccessToken()?.sub;
    if (!userId) return;
    setSaving(true);
    setError(null);
    const res = await apiFetch('/v1/health/medication-log', {
      method: 'POST',
      body: JSON.stringify({ studentId, medicationName: form.medicationName, dosage: form.dosage, administeredBy: userId, notes: form.notes || undefined }),
    });
    setSaving(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setForm({ medicationName: '', dosage: '', notes: '' });
    load(studentId);
  }

  return (
    <div>
      <div className={styles.formRow}>
        <select className={styles.select} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.last_name}, {s.first_name}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.formRow}>
        <input className={styles.textInput} placeholder="Medication" value={form.medicationName} onChange={(e) => setForm({ ...form, medicationName: e.target.value })} />
        <input className={styles.textInput} placeholder="Dosage" value={form.dosage} onChange={(e) => setForm({ ...form, dosage: e.target.value })} />
        <input className={styles.textInput} placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <Button type="button" onClick={log} disabled={saving || !form.medicationName || !form.dosage}>
          Log
        </Button>
      </div>
      {error && <ErrorState message={error} />}
      <p className={styles.hint}>Append-only log — no edit or delete, matching every other audit-relevant record in this system.</p>
      {loading ? (
        <LoadingState label="Loading medication log" rows={3} />
      ) : entries.length === 0 ? (
        <EmptyState title="No medication logged yet" message="Log an administration above." />
      ) : (
        entries
          .slice()
          .reverse()
          .map((e) => (
            <div key={e.id} className={styles.listRow}>
              <span>
                {e.medication_name} — {e.dosage}
                {e.notes && <> · {e.notes}</>}
              </span>
              <span className={styles.hint}>{new Date(e.administered_at).toLocaleString()}</span>
            </div>
          ))
      )}
    </div>
  );
}
