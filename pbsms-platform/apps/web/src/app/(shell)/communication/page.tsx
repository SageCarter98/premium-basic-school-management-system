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
interface SchoolClass {
  id: string;
  name: string;
  academic_year_id: string;
}
interface Enrolment {
  student_id: string;
  class_id: string;
  academic_year_id: string;
  status: string;
}
interface StaffMember {
  id: string;
  full_name: string;
}
interface Guardian {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
}
interface GuardianLink {
  student_id: string;
  guardian_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  has_report_access: boolean;
}

interface NotificationTemplate {
  id: string;
  code: string;
  channel: string;
  language: string | null;
  subject: string | null;
  body: string;
  variables: string[];
  sensitivity_level: string;
  version: number;
  is_active: boolean;
}
interface Notification {
  id: string;
  template_id: string | null;
  recipient_type: string;
  recipient_id: string;
  recipient_name: string;
  subject: string | null;
  body: string;
  sensitivity_level: string;
  is_urgent: boolean;
  status: string;
}
interface NotificationDelivery {
  id: string;
  notification_id: string;
  channel: string;
  attempt_sequence: number;
  status: string;
  provider_reference: string | null;
  error_message: string | null;
  cost_amount: string | null;
}
interface BackgroundJob {
  id: string;
  job_type: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
}
interface JobSchedule {
  id: string;
  job_type: string;
  frequency: string;
  next_run_at: string;
  last_run_at: string | null;
  is_active: boolean;
}
interface CommunicationPreference {
  id: string;
  recipient_type: string;
  recipient_id: string;
  channel: string;
  opted_in: boolean;
}
interface NotificationReport {
  id: string;
  notification_id: string | null;
  title: string;
  description: string | null;
  owner_user_id: string;
  assigned_by: string | null;
  deadline: string | null;
  status: string;
  evidence: string | null;
  escalation_level: number;
  escalated_to_user_id: string | null;
}
interface NotificationReportComment {
  id: string;
  author_user_id: string;
  comment: string;
  created_at: string;
}
interface TenantCommunicationSettings {
  monthly_sms_cost_threshold: string;
  alert_threshold_pct: string;
}
interface SmsSpendStatus {
  spent: number;
  threshold: number;
  alertThresholdAmount: number;
  alertTriggered: boolean;
  currency: string;
}

const CHANNELS = ['whatsapp', 'sms', 'email', 'in_app'];
const SENSITIVITY = ['normal', 'restricted', 'confidential'];

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = body?.message;
  return (Array.isArray(m) ? m.join('; ') : m) ?? fallback;
}

function staffName(staff: StaffMember[], id: string): string {
  return staff.find((s) => s.id === id)?.full_name ?? id.slice(0, 8) + '…';
}

const TABS = ['Compose', 'Templates', 'Delivery Log', 'Consent Registry', 'Reports', 'Settings'] as const;
type Tab = (typeof TABS)[number];

/**
 * SRS Chapter 26 (spec §7.11). Built on the already-real backend
 * communication module — no new backend surface. One real gap: the
 * spec's "Audience builder -- class, level, arrears, custom" has no
 * bulk-recipient backend at all (createNotification() takes exactly one
 * recipient); Compose's "By class" mode is a client-side composition —
 * resolve the class roster's guardians, then loop the same per-recipient
 * call — same pattern as Stage 7's batch invoice run. "Message thread"
 * (§7.11, Parent View surface) is not built: no threaded-reply backend
 * exists and Parent View (Stage 6) is already shipped without it —
 * genuinely blocked, not deferred by choice.
 */
export default function CommunicationPage() {
  const [tab, setTab] = useState<Tab>('Compose');
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canAccess = hasAnyRole(roleCodes, ACADEMIC_STAFF);
  const canConfigure = hasAnyRole(roleCodes, ACADEMIC_ADMIN);

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [guardians, setGuardians] = useState<Guardian[]>([]);

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    Promise.all([
      apiGet<Student[]>('/v1/students'),
      apiGet<SchoolClass[]>('/v1/classes'),
      apiGet<Enrolment[]>('/v1/enrolments'),
      apiGet<StaffMember[]>('/v1/staff'),
      apiGet<Guardian[]>('/v1/guardians'),
    ]).then(([s, c, e, st, g]) => {
      setStudents(s);
      setClasses(c);
      setEnrolments(e);
      setStaff(st);
      setGuardians(g);
      setLoading(false);
    });
  }, [canAccess]);

  if (!canAccess) {
    return (
      <Card>
        <RestrictedState message="Communication is available to teaching and administrative staff." />
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading communication" rows={4} />
      </Card>
    );
  }

  const shared = { students, classes, enrolments, staff, guardians, canConfigure };

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
        {tab === 'Compose' && <ComposeTab {...shared} />}
        {tab === 'Templates' && <TemplatesTab canConfigure={canConfigure} />}
        {tab === 'Delivery Log' && <DeliveryLogTab />}
        {tab === 'Consent Registry' && <ConsentRegistryTab {...shared} />}
        {tab === 'Reports' && <ReportsTab staff={staff} />}
        {tab === 'Settings' && <SettingsTab canConfigure={canConfigure} />}
      </Card>
    </div>
  );
}

interface SharedProps {
  students: Student[];
  classes: SchoolClass[];
  enrolments: Enrolment[];
  staff: StaffMember[];
  guardians: Guardian[];
  canConfigure: boolean;
}

// ---------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------

function ComposeTab({ students, classes, enrolments, staff, guardians }: SharedProps) {
  const [job, setJob] = useState<BackgroundJob | null>(null);
  const [schedules, setSchedules] = useState<JobSchedule[]>([]);
  const [showRepeat, setShowRepeat] = useState(false);
  const [repeatForm, setRepeatForm] = useState({ frequency: 'weekly', nextRunAt: '' });
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [mode, setMode] = useState<'single' | 'class'>('single');
  const [recipientType, setRecipientType] = useState<'student' | 'staff' | 'guardian'>('guardian');
  const [recipientId, setRecipientId] = useState('');
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [preview, setPreview] = useState<{ id: string; name: string; email: string | null; phone: string | null }[] | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sensitivity, setSensitivity] = useState('normal');
  const [urgent, setUrgent] = useState(false);
  const [sendNow, setSendNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function recipientOptions() {
    if (recipientType === 'student') return students.map((s) => ({ id: s.id, label: `${s.last_name}, ${s.first_name}` }));
    if (recipientType === 'staff') return staff.map((s) => ({ id: s.id, label: s.full_name }));
    return guardians.map((g) => ({ id: g.id, label: g.full_name }));
  }

  async function buildClassPreview() {
    setError(null);
    const targetStudentIds = enrolments.filter((e) => e.class_id === classId && e.status === 'active').map((e) => e.student_id);
    if (recipientType === 'guardian') {
      const links = await Promise.all(targetStudentIds.map((id) => apiGet<GuardianLink[]>(`/v1/students/${id}/guardians`)));
      const seen = new Set<string>();
      const rows: { id: string; name: string; email: string | null; phone: string | null }[] = [];
      links.flat().forEach((l) => {
        if (!l.has_report_access && recipientType === 'guardian') return; // guardians without report access don't get school comms
        if (seen.has(l.guardian_id)) return;
        seen.add(l.guardian_id);
        rows.push({ id: l.guardian_id, name: l.full_name, email: l.email, phone: l.phone });
      });
      setPreview(rows);
    } else {
      const rows = targetStudentIds.map((id) => {
        const s = students.find((st) => st.id === id);
        return { id, name: s ? `${s.last_name}, ${s.first_name}` : id, email: null, phone: null };
      });
      setPreview(rows);
    }
  }

  async function sendSingle() {
    setBusy(true);
    setError(null);
    setResult(null);
    const t = { id: recipientId, name: recipientOptions().find((o) => o.id === recipientId)?.label ?? recipientId };
    const createRes = await apiFetch('/v1/communication/notifications', {
      method: 'POST',
      body: JSON.stringify({ recipientType, recipientId: t.id, recipientName: t.name, subject: subject || undefined, body, sensitivityLevel: sensitivity, isUrgent: urgent }),
    });
    if (!createRes.ok) {
      setBusy(false);
      setResult('Failed to create notification.');
      return;
    }
    let sent = 0;
    if (sendNow) {
      const notif = (await createRes.json()) as Notification;
      const sendRes = await apiFetch(`/v1/communication/notifications/${notif.id}/send`, { method: 'POST' });
      if (sendRes.ok) sent++;
    }
    setBusy(false);
    setResult(`Created 1 notification(s)${sendNow ? `, ${sent} dispatch attempt(s) completed` : ''}.`);
  }

  // A real mass_notification background job exists (Chapter 35.1) and does
  // exactly this fan-out + per-recipient delivery server-side, with
  // per-item failure isolation — replacing the old client-side loop over
  // one createNotification()+send() call per recipient. That loop worked,
  // but meant one recipient's browser tab held the whole batch's progress
  // and a lost connection mid-send left no record of what had actually
  // gone out; the job runs to completion independent of this tab.
  async function sendClass() {
    setBusy(true);
    setError(null);
    setResult(null);
    setJob(null);
    const recipients = (preview ?? []).map((p) => ({
      recipientType,
      recipientId: p.id,
      recipientName: p.name,
      recipientPhone: p.phone ?? undefined,
      recipientEmail: p.email ?? undefined,
    }));
    const res = await apiFetch('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({
        jobType: 'mass_notification',
        payload: { subject: subject || undefined, body, sensitivityLevel: sensitivity, isUrgent: urgent, recipients },
      }),
    });
    if (!res.ok) {
      setBusy(false);
      setError('Could not enqueue the bulk send job.');
      return;
    }
    const enqueued = (await res.json()) as BackgroundJob;
    setJob(enqueued);
    await pollJob(enqueued.id);
  }

  async function pollJob(jobId: string) {
    // background_jobs.status is queued|running|succeeded|failed|dead_letter
    // (0027_background_jobs.sql) — confirmed live, not 'completed' as the
    // name might suggest.
    for (let i = 0; i < 40; i++) {
      const current = await apiGet<BackgroundJob>(`/v1/jobs/${jobId}`);
      setJob(current);
      if (current.status === 'succeeded' || current.status === 'failed' || current.status === 'dead_letter') {
        setBusy(false);
        setResult(current.status === 'succeeded' ? `Sent to ${(preview ?? []).length} recipient(s).` : `Job ${current.status}: ${current.last_error ?? 'unknown error'}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setBusy(false);
    setResult('Still running — check the Jobs status via the job id shown below.');
  }

  function send() {
    if (mode === 'single') return sendSingle();
    return sendClass();
  }

  function reloadSchedules() {
    apiGet<JobSchedule[]>('/v1/jobs/schedules/list').then((all) => setSchedules(all.filter((s) => s.job_type === 'mass_notification')));
  }
  useEffect(reloadSchedules, []);

  // A real generic scheduler already runs (Chapter 35.1's job_schedules +
  // worker.ts's scheduleLoop()) and mass_notification was already a
  // whitelisted schedulable job type — this was purely a missing UI to
  // create one, not a missing backend feature.
  async function createSchedule() {
    setScheduleBusy(true);
    setScheduleError(null);
    const recipients = (preview ?? []).map((p) => ({
      recipientType,
      recipientId: p.id,
      recipientName: p.name,
      recipientPhone: p.phone ?? undefined,
      recipientEmail: p.email ?? undefined,
    }));
    const res = await apiFetch('/v1/jobs/schedules', {
      method: 'POST',
      body: JSON.stringify({
        jobType: 'mass_notification',
        payloadTemplate: { subject: subject || undefined, body, sensitivityLevel: sensitivity, isUrgent: urgent, recipients },
        frequency: repeatForm.frequency,
        nextRunAt: new Date(repeatForm.nextRunAt).toISOString(),
      }),
    });
    setScheduleBusy(false);
    if (!res.ok) return setScheduleError(await errorMessage(res, `Failed (${res.status})`));
    setShowRepeat(false);
    setRepeatForm({ frequency: 'weekly', nextRunAt: '' });
    reloadSchedules();
  }

  async function deactivateSchedule(id: string) {
    setScheduleBusy(true);
    await apiFetch(`/v1/jobs/schedules/${id}/deactivate`, { method: 'POST' });
    setScheduleBusy(false);
    reloadSchedules();
  }

  return (
    <div>
      <div className={styles.formRow}>
        <select className={styles.select} value={mode} onChange={(e) => { setMode(e.target.value as 'single' | 'class'); setPreview(null); }}>
          <option value="single">Single recipient</option>
          <option value="class">By class (audience)</option>
        </select>
        <select className={styles.select} value={recipientType} onChange={(e) => { setRecipientType(e.target.value as 'student' | 'staff' | 'guardian'); setRecipientId(''); setPreview(null); }}>
          <option value="guardian">Guardian</option>
          <option value="student">Student</option>
          <option value="staff">Staff</option>
        </select>
      </div>

      {mode === 'single' ? (
        <div className={styles.formRow}>
          <select className={styles.select} value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
            <option value="">Choose a recipient</option>
            {recipientOptions().map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <div className={styles.formRow}>
            <select className={styles.select} value={classId} onChange={(e) => { setClassId(e.target.value); setPreview(null); }}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Button type="button" variant="secondary" onClick={buildClassPreview} disabled={!classId}>
              Preview audience
            </Button>
          </div>
          {preview && (
            <div className={styles.detailPanel} style={{ marginBottom: 'var(--pb-space-3)' }}>
              {preview.length === 0 ? (
                <EmptyState title="No recipients" message={recipientType === 'guardian' ? 'No linked guardian has report access for this class roster.' : 'This class has no active enrolments.'} />
              ) : (
                <>
                  <p className={styles.hint}>{preview.length} recipient(s):</p>
                  {preview.map((p) => (
                    <div key={p.id} className={styles.listRow}>
                      <span>{p.name}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}

      <div className={styles.formRow}>
        <input className={styles.textInput} placeholder="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <select className={styles.select} value={sensitivity} onChange={(e) => setSensitivity(e.target.value)}>
          {SENSITIVITY.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.formRow}>
        <textarea className={styles.textArea} placeholder="Message body" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className={styles.formRow}>
        <label className={styles.checklistItem}>
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent (widens the fallback chain to whatsapp→sms→email)
        </label>
        <label className={styles.checklistItem}>
          <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} /> Send immediately
        </label>
      </div>

      {error && <ErrorState message={error} />}
      {job && (
        <p className={styles.hint}>
          Bulk send job <strong>{job.id}</strong> — <Pill variant={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'danger' : 'neutral'}>{job.status}</Pill>
          {job.attempt_count > 0 && ` · attempt ${job.attempt_count}`}
        </p>
      )}
      {result && <p className={styles.hint}>{result}</p>}
      <p className={styles.hint}>
        No real WhatsApp/SMS/email provider is wired up in this environment — every send attempt honestly ends &quot;exhausted&quot;. Check the Delivery Log tab for the real per-channel outcome.
      </p>

      <Button
        type="button"
        onClick={send}
        disabled={busy || !body || (mode === 'single' ? !recipientId : !preview || preview.length === 0)}
      >
        {mode === 'single' ? 'Send' : `Send to ${preview?.length ?? 0} recipient(s)`}
      </Button>

      {mode === 'class' && (
        <div style={{ marginTop: 'var(--pb-space-4)' }}>
          <Button type="button" variant="secondary" onClick={() => setShowRepeat((v) => !v)} disabled={!preview || preview.length === 0}>
            {showRepeat ? 'Cancel' : 'Repeat this send…'}
          </Button>
          {showRepeat && (
            <div className={styles.formRow} style={{ marginTop: 'var(--pb-space-2)' }}>
              <select aria-label="Repeat frequency" className={styles.select} value={repeatForm.frequency} onChange={(e) => setRepeatForm({ ...repeatForm, frequency: e.target.value })}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="termly">Termly</option>
                <option value="yearly">Yearly</option>
              </select>
              <input
                aria-label="First run date and time"
                className={styles.textInput}
                type="datetime-local"
                value={repeatForm.nextRunAt}
                onChange={(e) => setRepeatForm({ ...repeatForm, nextRunAt: e.target.value })}
              />
              <Button type="button" onClick={createSchedule} disabled={scheduleBusy || !repeatForm.nextRunAt || !body}>
                Create schedule
              </Button>
            </div>
          )}
          {scheduleError && <ErrorState message={scheduleError} />}
        </div>
      )}

      {schedules.length > 0 && (
        <div style={{ marginTop: 'var(--pb-space-4)' }}>
          <p className={styles.hint}>Active recurring sends</p>
          {schedules.map((s) => (
            <div key={s.id} className={styles.listRow}>
              <span>
                {s.frequency} — next {new Date(s.next_run_at).toLocaleString()}
                {s.last_run_at && <> · last ran {new Date(s.last_run_at).toLocaleString()}</>}
              </span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                <Pill variant={s.is_active ? 'success' : 'neutral'}>{s.is_active ? 'active' : 'inactive'}</Pill>
                {s.is_active && (
                  <Button type="button" variant="secondary" onClick={() => deactivateSchedule(s.id)} disabled={scheduleBusy}>
                    Deactivate
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------

function TemplatesTab({ canConfigure }: { canConfigure: boolean }) {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: '', channel: 'email', subject: '', body: '', variables: '', sensitivityLevel: 'normal' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [versions, setVersions] = useState<NotificationTemplate[]>([]);
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({});
  const [previewResult, setPreviewResult] = useState<{ subject: string | null; body: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<NotificationTemplate[]>('/v1/communication/templates')
      .then(setTemplates)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/communication/templates', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code,
          channel: form.channel,
          subject: form.subject || undefined,
          body: form.body,
          variables: form.variables ? form.variables.split(',').map((v) => v.trim()).filter(Boolean) : undefined,
          sensitivityLevel: form.sensitivityLevel,
        }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm({ code: '', channel: 'email', subject: '', body: '', variables: '', sensitivityLevel: 'normal' });
      setShowCreate(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create template.');
    } finally {
      setSaving(false);
    }
  }

  async function expand(code: string) {
    if (expandedCode === code) {
      setExpandedCode(null);
      return;
    }
    setExpandedCode(code);
    setPreviewResult(null);
    setPreviewError(null);
    setVersions(await apiGet<NotificationTemplate[]>(`/v1/communication/templates/by-code/${encodeURIComponent(code)}/versions`));
  }

  async function runPreview(templateId: string) {
    setPreviewError(null);
    const res = await apiFetch(`/v1/communication/templates/${templateId}/preview`, { method: 'POST', body: JSON.stringify({ variables: previewVars }) });
    if (!res.ok) return setPreviewError(await errorMessage(res, `Failed (${res.status})`));
    setPreviewResult((await res.json()) as { subject: string | null; body: string });
  }

  const activeByCode = Object.values(
    templates.reduce<Record<string, NotificationTemplate>>((acc, t) => {
      if (t.is_active) acc[t.code] = t;
      return acc;
    }, {}),
  );

  if (loading) return <LoadingState label="Loading templates" rows={3} />;

  return (
    <div>
      {canConfigure && (
        <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
          {showCreate ? 'Cancel' : 'New template / new version'}
        </Button>
      )}
      {showCreate && (
        <div style={{ marginBottom: 'var(--pb-space-3)' }}>
          <p className={styles.hint}>Creating with an existing code retires that code&apos;s active version and inserts the next one — no separate activate step.</p>
          <div className={styles.formRow}>
            <input className={styles.textInput} placeholder="Code, e.g. fee-reminder" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <select className={styles.select} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select className={styles.select} value={form.sensitivityLevel} onChange={(e) => setForm({ ...form, sensitivityLevel: e.target.value })}>
              {SENSITIVITY.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.formRow}>
            <input className={styles.textInput} placeholder="Subject (optional)" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            <input className={styles.textInput} placeholder="Variable names, comma-separated, e.g. studentName,amount" value={form.variables} onChange={(e) => setForm({ ...form, variables: e.target.value })} />
          </div>
          <div className={styles.formRow}>
            <textarea className={styles.textArea} placeholder="Body — use {{variableName}} placeholders" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </div>
          <Button type="button" onClick={handleCreate} disabled={saving || !form.code || !form.body}>
            Save
          </Button>
        </div>
      )}
      {saveError && <ErrorState message={saveError} />}
      {activeByCode.length === 0 ? (
        <EmptyState title="No templates yet" message="Create one to reuse across Compose sends." />
      ) : (
        activeByCode.map((t) => (
          <div key={t.code}>
            <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => expand(t.code)}>
              <span>
                {t.code} — {t.channel} · v{t.version}
              </span>
              <Pill variant="success">active</Pill>
            </div>
            {expandedCode === t.code && (
              <div className={styles.detailPanel}>
                <div className={styles.detailSection}>
                  <div className={styles.detailSectionTitle}>Version history</div>
                  {versions.map((v) => (
                    <div key={v.id} className={styles.listRow}>
                      <span>
                        v{v.version} — {v.subject ?? '(no subject)'}
                      </span>
                      <Pill variant={v.is_active ? 'success' : 'neutral'}>{v.is_active ? 'active' : 'retired'}</Pill>
                    </div>
                  ))}
                </div>
                {t.variables.length > 0 && (
                  <div className={styles.detailSection}>
                    <div className={styles.detailSectionTitle}>Preview with variables</div>
                    <div className={styles.formRow}>
                      {t.variables.map((v) => (
                        <input
                          key={v}
                          className={styles.textInput}
                          placeholder={v}
                          value={previewVars[v] ?? ''}
                          onChange={(e) => setPreviewVars((pv) => ({ ...pv, [v]: e.target.value }))}
                        />
                      ))}
                      <Button type="button" variant="secondary" onClick={() => runPreview(t.id)}>
                        Preview
                      </Button>
                    </div>
                    {previewError && <ErrorState message={previewError} />}
                    {previewResult && (
                      <div className={styles.previewBox}>
                        {previewResult.subject && <p style={{ fontWeight: 700 }}>{previewResult.subject}</p>}
                        <p>{previewResult.body}</p>
                      </div>
                    )}
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

// ---------------------------------------------------------------------
// Delivery Log
// ---------------------------------------------------------------------

const NOTIF_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  queued: 'neutral',
  sending: 'warning',
  delivered: 'success',
  exhausted: 'danger',
};

function DeliveryLogTab() {
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    setLoading(true);
    apiGet<Notification[]>('/v1/communication/notifications')
      .then(setNotifications)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function expand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setDeliveries(await apiGet<NotificationDelivery[]>(`/v1/communication/notifications/${id}/deliveries`));
  }

  async function resend(id: string) {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/communication/notifications/${id}/send`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
    expand(id);
  }

  if (loading) return <LoadingState label="Loading the delivery log" rows={4} />;

  return (
    <div>
      {error && <ErrorState message={error} />}
      {notifications.length === 0 ? (
        <EmptyState title="No notifications yet" message="Send one from the Compose tab." />
      ) : (
        notifications
          .slice()
          .reverse()
          .map((n) => (
            <div key={n.id}>
              <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => expand(n.id)}>
                <span>
                  {n.recipient_name} ({n.recipient_type}) — {n.subject ?? n.body.slice(0, 40)}
                </span>
                <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                  {n.is_urgent && <Pill variant="danger">urgent</Pill>}
                  <Pill variant={NOTIF_STATUS_VARIANT[n.status] ?? 'neutral'}>{n.status}</Pill>
                </span>
              </div>
              {expandedId === n.id && (
                <div className={styles.detailPanel}>
                  {deliveries.length === 0 ? (
                    <EmptyState title="No delivery attempts recorded" message="Send this notification to see the real per-channel outcome." />
                  ) : (
                    deliveries.map((d) => (
                      <div key={d.id} className={styles.listRow}>
                        <span>
                          #{d.attempt_sequence} {d.channel}
                          {d.error_message && <> — {d.error_message}</>}
                        </span>
                        <Pill variant={d.status === 'delivered' ? 'success' : d.status === 'blocked_by_preference' ? 'neutral' : 'danger'}>{d.status}</Pill>
                      </div>
                    ))
                  )}
                  {(n.status === 'queued' || n.status === 'exhausted') && (
                    <Button type="button" variant="secondary" onClick={() => resend(n.id)} disabled={busy} style={{ marginTop: 'var(--pb-space-2)' }}>
                      {n.status === 'exhausted' ? 'Retry' : 'Send'}
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

// ---------------------------------------------------------------------
// Consent Registry
// ---------------------------------------------------------------------

function ConsentRegistryTab({ students, staff, guardians }: SharedProps) {
  const [recipientType, setRecipientType] = useState<'student' | 'staff' | 'guardian'>('guardian');
  const [recipientId, setRecipientId] = useState('');
  const [prefs, setPrefs] = useState<CommunicationPreference[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  function recipientOptions() {
    if (recipientType === 'student') return students.map((s) => ({ id: s.id, label: `${s.last_name}, ${s.first_name}` }));
    if (recipientType === 'staff') return staff.map((s) => ({ id: s.id, label: s.full_name }));
    return guardians.map((g) => ({ id: g.id, label: g.full_name }));
  }

  async function load(id: string) {
    if (!id) {
      setPrefs([]);
      return;
    }
    setLoading(true);
    const rows = await apiGet<CommunicationPreference[]>(`/v1/communication/preferences/${recipientType}/${id}`);
    setPrefs(rows);
    setLoading(false);
  }

  async function toggle(channel: string, optedIn: boolean) {
    setBusy(true);
    await apiFetch('/v1/communication/preferences', { method: 'POST', body: JSON.stringify({ recipientType, recipientId, channel, optedIn }) });
    await load(recipientId);
    setBusy(false);
  }

  return (
    <div>
      <p className={styles.hint}>Per-recipient, per-channel opt-out honoured before any send is attempted (FR-COM-030).</p>
      <div className={styles.formRow}>
        <select className={styles.select} value={recipientType} onChange={(e) => { setRecipientType(e.target.value as 'student' | 'staff' | 'guardian'); setRecipientId(''); setPrefs([]); }}>
          <option value="guardian">Guardian</option>
          <option value="student">Student</option>
          <option value="staff">Staff</option>
        </select>
        <select className={styles.select} value={recipientId} onChange={(e) => { setRecipientId(e.target.value); load(e.target.value); }}>
          <option value="">Choose a recipient</option>
          {recipientOptions().map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {recipientId && (loading ? (
        <LoadingState label="Loading preferences" rows={3} />
      ) : (
        CHANNELS.filter((c) => c !== 'in_app').map((c) => {
          const pref = prefs.find((p) => p.channel === c);
          const optedIn = pref?.opted_in ?? true;
          return (
            <div key={c} className={styles.listRow}>
              <span>{c}</span>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => toggle(c, !optedIn)}>
                {optedIn ? 'Opted in — withdraw' : 'Opted out — re-consent'}
              </Button>
            </div>
          );
        })
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Reports (acknowledgeable-report workflow)
// ---------------------------------------------------------------------

const REPORT_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  open: 'warning',
  acknowledged: 'warning',
  in_progress: 'warning',
  completed: 'success',
  reopened: 'danger',
};

function ReportsTab({ staff }: { staff: StaffMember[] }) {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<NotificationReport[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', ownerUserId: staff[0]?.id ?? '', deadline: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [comments, setComments] = useState<NotificationReportComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<NotificationReport[]>('/v1/communication/reports')
      .then(setReports)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/communication/reports', {
        method: 'POST',
        body: JSON.stringify({ title: form.title, description: form.description || undefined, ownerUserId: form.ownerUserId, deadline: form.deadline || undefined }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm((f) => ({ ...f, title: '', description: '', deadline: '' }));
      setShowCreate(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create report.');
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, action: string, body?: unknown) {
    setError(null);
    const res = await apiFetch(`/v1/communication/reports/${id}/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
  }

  async function expand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setComments(await apiGet<NotificationReportComment[]>(`/v1/communication/reports/${id}/comments`));
  }

  async function addComment(id: string) {
    if (!newComment.trim()) return;
    await apiFetch(`/v1/communication/reports/${id}/comments`, { method: 'POST', body: JSON.stringify({ authorUserId: form.ownerUserId, comment: newComment }) });
    setNewComment('');
    setComments(await apiGet<NotificationReportComment[]>(`/v1/communication/reports/${id}/comments`));
  }

  if (loading) return <LoadingState label="Loading reports" rows={3} />;

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showCreate ? 'Cancel' : 'Assign report'}
      </Button>
      {showCreate && (
        <div style={{ marginBottom: 'var(--pb-space-3)' }}>
          <div className={styles.formRow}>
            <input className={styles.textInput} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <select className={styles.select} value={form.ownerUserId} onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
            <input className={styles.textInput} type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </div>
          <div className={styles.formRow}>
            <textarea className={styles.textArea} placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <Button type="button" onClick={handleCreate} disabled={saving || !form.title || !form.ownerUserId}>
            Save
          </Button>
        </div>
      )}
      {saveError && <ErrorState message={saveError} />}
      {error && <ErrorState message={error} />}
      {reports.length === 0 ? (
        <EmptyState title="No reports assigned yet" message="Assign one to track a follow-up to completion." />
      ) : (
        reports.map((r) => (
          <div key={r.id}>
            <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => expand(r.id)}>
              <span>
                {r.title} — owner {staffName(staff, r.owner_user_id)}
                {r.deadline && <> · due {r.deadline}</>}
                {r.escalation_level > 0 && <> · escalated ×{r.escalation_level}</>}
              </span>
              <Pill variant={REPORT_STATUS_VARIANT[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Pill>
            </div>
            {expandedId === r.id && (
              <div className={styles.detailPanel}>
                {r.description && <p>{r.description}</p>}
                {r.evidence && (
                  <p>
                    <strong>Evidence:</strong> {r.evidence}
                  </p>
                )}
                <div className={styles.actionRow}>
                  {r.status === 'open' && (
                    <Button type="button" onClick={() => act(r.id, 'acknowledge')}>
                      Acknowledge
                    </Button>
                  )}
                  {['acknowledged', 'reopened'].includes(r.status) && (
                    <Button type="button" onClick={() => act(r.id, 'start')}>
                      Start
                    </Button>
                  )}
                  {r.status !== 'completed' && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        const evidence = window.prompt('Evidence for this report:');
                        if (evidence) act(r.id, 'evidence', { evidence });
                      }}
                    >
                      Add evidence
                    </Button>
                  )}
                  {['acknowledged', 'in_progress'].includes(r.status) && (
                    <Button type="button" onClick={() => act(r.id, 'complete')}>
                      Complete
                    </Button>
                  )}
                  {r.status === 'completed' && (
                    <Button type="button" variant="secondary" onClick={() => act(r.id, 'reopen')}>
                      Reopen
                    </Button>
                  )}
                  {r.status !== 'completed' && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        const escalatedToUserId = window.prompt('Staff id to escalate to:');
                        if (escalatedToUserId) act(r.id, 'escalate', { escalatedToUserId });
                      }}
                    >
                      Escalate
                    </Button>
                  )}
                </div>
                <div className={styles.detailSection} style={{ marginTop: 'var(--pb-space-3)' }}>
                  <div className={styles.detailSectionTitle}>Comments</div>
                  {comments.map((c) => (
                    <div key={c.id} className={styles.listRow}>
                      <span>{c.comment}</span>
                      <span className={styles.hint}>{staffName(staff, c.author_user_id)}</span>
                    </div>
                  ))}
                  <div className={styles.formRow}>
                    <input className={styles.textInput} placeholder="Add a comment" value={newComment} onChange={(e) => setNewComment(e.target.value)} />
                    <Button type="button" variant="secondary" onClick={() => addComment(r.id)}>
                      Post
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

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------

function SettingsTab({ canConfigure }: { canConfigure: boolean }) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<TenantCommunicationSettings | null>(null);
  const [spend, setSpend] = useState<SmsSpendStatus | null>(null);
  const [form, setForm] = useState({ monthlySmsCostThreshold: '', alertThresholdPct: '80' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<TenantCommunicationSettings | null>('/v1/communication/settings')
      .then((s) => {
        setSettings(s);
        if (s) setForm({ monthlySmsCostThreshold: s.monthly_sms_cost_threshold, alertThresholdPct: s.alert_threshold_pct });
        return apiGet<SmsSpendStatus>('/v1/communication/settings/sms-spend').catch(() => null);
      })
      .then(setSpend)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await apiFetch('/v1/communication/settings', {
      method: 'POST',
      body: JSON.stringify({ monthlySmsCostThreshold: Number(form.monthlySmsCostThreshold), alertThresholdPct: Number(form.alertThresholdPct) }),
    });
    setSaving(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
  }

  if (loading) return <LoadingState label="Loading settings" rows={2} />;

  return (
    <div>
      {!canConfigure && <RestrictedState message="Only school leadership can change communication settings." />}
      {canConfigure && (
        <>
          <div className={styles.formRow}>
            <input className={styles.textInput} type="number" min="0" step="0.01" placeholder="Monthly SMS cost threshold" value={form.monthlySmsCostThreshold} onChange={(e) => setForm({ ...form, monthlySmsCostThreshold: e.target.value })} />
            <input className={styles.textInput} type="number" min="1" max="100" placeholder="Alert threshold %" value={form.alertThresholdPct} onChange={(e) => setForm({ ...form, alertThresholdPct: e.target.value })} />
            <Button type="button" onClick={save} disabled={saving || !form.monthlySmsCostThreshold}>
              Save
            </Button>
          </div>
          {error && <ErrorState message={error} />}
        </>
      )}
      {!settings ? (
        <EmptyState title="No settings configured yet" message="Set a monthly SMS cost threshold to enable spend alerting." />
      ) : spend ? (
        <div className={styles.statRow}>
          <div className={styles.statTile}>
            <div className={styles.statTileValue}>
              {spend.currency}
              {spend.spent.toFixed(2)}
            </div>
            <div className={styles.statTileLabel}>Spent this month</div>
          </div>
          <div className={styles.statTile}>
            <div className={styles.statTileValue}>
              {spend.currency}
              {spend.threshold.toFixed(2)}
            </div>
            <div className={styles.statTileLabel}>Monthly threshold</div>
          </div>
          {spend.alertTriggered && <Pill variant="danger">alert threshold reached</Pill>}
        </div>
      ) : null}
      <p className={styles.hint}>Spend is always 0 in this environment — no real SMS provider sends a billable message here yet.</p>
    </div>
  );
}
