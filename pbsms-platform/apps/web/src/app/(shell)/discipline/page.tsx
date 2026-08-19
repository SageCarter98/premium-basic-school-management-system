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
import { ACADEMIC_ADMIN, ACADEMIC_STAFF, hasAnyRole } from '@/lib/role-groups';
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
interface DisciplineCase {
  id: string;
  student_id: string;
  category: string;
  severity: string;
  incident_date: string;
  description: string;
  reported_by: string;
  status: string;
  closed_at: string | null;
  reopened_at: string | null;
}
interface DisciplineCaseNote {
  id: string;
  author_user_id: string;
  note: string;
  created_at: string;
}
interface DisciplineCaseResponse {
  id: string;
  response_type: string;
  description: string;
  created_at: string;
}
interface DisciplineAppeal {
  id: string;
  case_id: string;
  raised_by: string;
  reason: string;
  filed_at: string;
  decision: string;
  decided_at: string | null;
  decision_notes: string | null;
}
interface DisciplineRecognition {
  id: string;
  student_id: string;
  category: string;
  description: string;
  awarded_by: string;
  awarded_at: string;
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
const RESPONSE_TYPES = ['warning', 'detention', 'suspension', 'expulsion_recommendation', 'other'];

const CASE_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  reported: 'warning',
  investigating: 'warning',
  response_issued: 'warning',
  appealed: 'danger',
  closed: 'success',
};

const TABS = ['Cases', 'Recognitions'] as const;
type Tab = (typeof TABS)[number];

/** SRS Chapter 28 (spec §7.13 "Discipline — case, investigation, response, appeal"). Any teacher can report a case or recognize good behaviour — investigation/response/close/appeal are ACADEMIC_ADMIN. */
export default function DisciplinePage() {
  const [tab, setTab] = useState<Tab>('Cases');
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canAccess = hasAnyRole(roleCodes, ACADEMIC_STAFF);
  const canAdmin = hasAnyRole(roleCodes, ACADEMIC_ADMIN);

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
        <RestrictedState message="Discipline is available to teaching and administrative staff." />
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading discipline" rows={4} />
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
        {tab === 'Cases' && <CasesTab students={students} guardians={guardians} canAdmin={canAdmin} />}
        {tab === 'Recognitions' && <RecognitionsTab students={students} />}
      </Card>
    </div>
  );
}

function CasesTab({ students, guardians, canAdmin }: { students: Student[]; guardians: Guardian[]; canAdmin: boolean }) {
  const userId = decodeAccessToken()?.sub ?? '';
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<DisciplineCase[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ studentId: students[0]?.id ?? '', category: '', severity: 'minor', incidentDate: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<DisciplineCaseNote[]>([]);
  const [responses, setResponses] = useState<DisciplineCaseResponse[]>([]);
  const [appeals, setAppeals] = useState<DisciplineAppeal[]>([]);
  const [newNote, setNewNote] = useState('');
  const [responseForm, setResponseForm] = useState({ responseType: 'warning', description: '' });
  const [contactGuardianId, setContactGuardianId] = useState('');
  const [contactNotes, setContactNotes] = useState('');

  function reload() {
    setLoading(true);
    apiGet<DisciplineCase[]>('/v1/discipline/cases')
      .then(setCases)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function create() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/discipline/cases', {
        method: 'POST',
        body: JSON.stringify({ ...form, incidentDate: form.incidentDate || new Date().toISOString(), reportedBy: userId }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm((f) => ({ ...f, category: '', description: '', incidentDate: '' }));
      setShowCreate(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not report case.');
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, action: string, body?: unknown) {
    setError(null);
    const res = await apiFetch(`/v1/discipline/cases/${id}/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
    if (expandedId === id) refreshDetail(id);
  }

  async function refreshDetail(id: string) {
    const [n, r, a] = await Promise.all([
      apiGet<DisciplineCaseNote[]>(`/v1/discipline/cases/${id}/notes`),
      apiGet<DisciplineCaseResponse[]>(`/v1/discipline/cases/${id}/responses`),
      apiGet<DisciplineAppeal[]>(`/v1/discipline/cases/${id}/appeals`),
    ]);
    setNotes(n);
    setResponses(r);
    setAppeals(a);
  }

  async function expand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    refreshDetail(id);
  }

  async function addNote(id: string) {
    if (!newNote.trim()) return;
    await apiFetch(`/v1/discipline/cases/${id}/notes`, { method: 'POST', body: JSON.stringify({ authorUserId: userId, note: newNote }) });
    setNewNote('');
    refreshDetail(id);
  }

  async function issueResponse(id: string) {
    setError(null);
    const res = await apiFetch(`/v1/discipline/cases/${id}/responses`, { method: 'POST', body: JSON.stringify({ ...responseForm, issuedBy: userId }) });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setResponseForm({ responseType: 'warning', description: '' });
    reload();
    refreshDetail(id);
  }

  async function fileAppeal(id: string) {
    const reason = window.prompt('Reason for the appeal:');
    if (!reason) return;
    setError(null);
    const res = await apiFetch(`/v1/discipline/cases/${id}/appeals`, { method: 'POST', body: JSON.stringify({ raisedBy: userId, reason }) });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
    refreshDetail(id);
  }

  async function decideAppeal(appealId: string, decision: 'upheld' | 'denied') {
    const decisionNotes = window.prompt(`Notes for this ${decision} decision (optional):`) ?? undefined;
    setError(null);
    const res = await apiFetch(`/v1/discipline/appeals/${appealId}/decide`, { method: 'POST', body: JSON.stringify({ decision, decidedBy: userId, decisionNotes }) });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
    if (expandedId) refreshDetail(expandedId);
  }

  async function contactGuardian(caseId: string) {
    const guardian = guardians.find((g) => g.id === contactGuardianId);
    if (!guardian || !contactNotes) return;
    setError(null);
    const res = await apiFetch(`/v1/discipline/cases/${caseId}/guardian-contacts`, {
      method: 'POST',
      body: JSON.stringify({ recipientType: 'guardian', recipientId: guardian.id, recipientName: guardian.full_name, channel: 'phone_call', notes: contactNotes, contactedBy: userId }),
    });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setContactGuardianId('');
    setContactNotes('');
  }

  if (loading) return <LoadingState label="Loading discipline cases" rows={3} />;

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showCreate ? 'Cancel' : 'Report case'}
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
            <input className={styles.textInput} placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
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
          <Button type="button" onClick={create} disabled={saving || !form.category || !form.description}>
            Save
          </Button>
          {saveError && <ErrorState message={saveError} />}
        </div>
      )}
      {error && <ErrorState message={error} />}
      {cases.length === 0 ? (
        <EmptyState title="No cases reported yet" message="Report one above." />
      ) : (
        cases.map((c) => (
          <div key={c.id}>
            <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => expand(c.id)}>
              <span>
                {studentName(students, c.student_id)} — {c.category} · {new Date(c.incident_date).toLocaleDateString()}
              </span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                <Pill variant={c.severity === 'severe' || c.severity === 'major' ? 'danger' : 'warning'}>{c.severity}</Pill>
                <Pill variant={CASE_STATUS_VARIANT[c.status] ?? 'neutral'}>{c.status.replace('_', ' ')}</Pill>
              </span>
            </div>
            {expandedId === c.id && (
              <div className={styles.detailPanel}>
                <p>{c.description}</p>
                {canAdmin && (
                  <div className={styles.actionRow}>
                    {c.status === 'reported' && (
                      <Button type="button" onClick={() => act(c.id, 'start-investigation')}>
                        Start investigation
                      </Button>
                    )}
                    {c.status === 'response_issued' && (
                      <Button type="button" onClick={() => act(c.id, 'close')}>
                        Close case
                      </Button>
                    )}
                    {c.status === 'closed' && (
                      <Button type="button" variant="secondary" onClick={() => act(c.id, 'reopen')}>
                        Reopen
                      </Button>
                    )}
                    {c.status === 'response_issued' && (
                      <Button type="button" variant="secondary" onClick={() => fileAppeal(c.id)}>
                        File appeal
                      </Button>
                    )}
                  </div>
                )}

                {canAdmin && ['reported', 'investigating'].includes(c.status) && (
                  <div className={styles.detailSection} style={{ marginTop: 'var(--pb-space-3)' }}>
                    <div className={styles.detailSectionTitle}>Issue response</div>
                    <div className={styles.formRow}>
                      <select className={styles.select} value={responseForm.responseType} onChange={(e) => setResponseForm({ ...responseForm, responseType: e.target.value })}>
                        {RESPONSE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t.replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                      <input className={styles.textInput} placeholder="Description" value={responseForm.description} onChange={(e) => setResponseForm({ ...responseForm, description: e.target.value })} />
                      <Button type="button" variant="secondary" onClick={() => issueResponse(c.id)} disabled={!responseForm.description}>
                        Issue
                      </Button>
                    </div>
                  </div>
                )}

                {responses.length > 0 && (
                  <div className={styles.detailSection}>
                    <div className={styles.detailSectionTitle}>Responses</div>
                    {responses.map((r) => (
                      <div key={r.id} className={styles.listRow}>
                        <span>
                          {r.response_type.replace('_', ' ')} — {r.description}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {appeals.length > 0 && (
                  <div className={styles.detailSection}>
                    <div className={styles.detailSectionTitle}>Appeals</div>
                    {appeals.map((a) => (
                      <div key={a.id} className={styles.listRow}>
                        <span>{a.reason}</span>
                        <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                          <Pill variant={a.decision === 'pending' ? 'warning' : a.decision === 'upheld' ? 'success' : 'danger'}>{a.decision}</Pill>
                          {canAdmin && a.decision === 'pending' && (
                            <>
                              <Button type="button" onClick={() => decideAppeal(a.id, 'upheld')}>
                                Uphold
                              </Button>
                              <Button type="button" variant="secondary" onClick={() => decideAppeal(a.id, 'denied')}>
                                Deny
                              </Button>
                            </>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className={styles.detailSection}>
                  <div className={styles.detailSectionTitle}>Notes</div>
                  {notes.map((n) => (
                    <div key={n.id} className={styles.listRow}>
                      <span>{n.note}</span>
                      <span className={styles.hint}>{new Date(n.created_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                  <div className={styles.formRow}>
                    <input className={styles.textInput} placeholder="Add a note" value={newNote} onChange={(e) => setNewNote(e.target.value)} />
                    <Button type="button" variant="secondary" onClick={() => addNote(c.id)}>
                      Post
                    </Button>
                  </div>
                </div>

                {canAdmin && (
                  <div className={styles.detailSection}>
                    <div className={styles.detailSectionTitle}>Contact guardian</div>
                    <div className={styles.formRow}>
                      <select className={styles.select} value={contactGuardianId} onChange={(e) => setContactGuardianId(e.target.value)}>
                        <option value="">Choose a guardian</option>
                        {guardians.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.full_name}
                          </option>
                        ))}
                      </select>
                      <input className={styles.textInput} placeholder="Notes" value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} />
                      <Button type="button" variant="secondary" onClick={() => contactGuardian(c.id)} disabled={!contactGuardianId || !contactNotes}>
                        Log contact
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function RecognitionsTab({ students }: { students: Student[] }) {
  const userId = decodeAccessToken()?.sub ?? '';
  const [loading, setLoading] = useState(true);
  const [recognitions, setRecognitions] = useState<DisciplineRecognition[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ studentId: students[0]?.id ?? '', category: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<DisciplineRecognition[]>('/v1/discipline/recognitions')
      .then(setRecognitions)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/v1/discipline/recognitions', { method: 'POST', body: JSON.stringify({ ...form, awardedBy: userId }) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm((f) => ({ ...f, category: '', description: '' }));
      setShowCreate(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record recognition.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading recognitions" rows={3} />;

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showCreate ? 'Cancel' : 'Recognize good behaviour'}
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
            <input className={styles.textInput} placeholder="Category, e.g. Leadership" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <div className={styles.formRow}>
            <textarea className={styles.textArea} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <Button type="button" onClick={create} disabled={saving || !form.category || !form.description}>
            Save
          </Button>
        </div>
      )}
      {error && <ErrorState message={error} />}
      {recognitions.length === 0 ? (
        <EmptyState title="No recognitions yet" message="Recognize a student's good behaviour above." />
      ) : (
        recognitions.map((r) => (
          <div key={r.id} className={styles.listRow}>
            <span>
              {studentName(students, r.student_id)} — {r.category}: {r.description}
            </span>
            <span className={styles.hint}>{new Date(r.awarded_at).toLocaleDateString()}</span>
          </div>
        ))
      )}
    </div>
  );
}
