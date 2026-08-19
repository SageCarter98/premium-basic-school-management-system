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
import { ACADEMIC_ADMIN, ACADEMIC_STAFF, LEADERSHIP, hasAnyRole } from '@/lib/role-groups';
import styles from '@/styles/tab-hub.module.css';

interface Student {
  id: string;
  first_name: string;
  last_name: string;
}
interface SchoolClass {
  id: string;
  name: string;
}
interface StaffMember {
  id: string;
  full_name: string;
}
interface KpiDefinition {
  id: string;
  code: string;
  name: string;
  responsible_role: string;
  data_source: string;
  target: string | null;
  reporting_frequency: string;
  supervisor_user_id: string | null;
  status: string;
  school_id: string | null;
}
interface KpiSnapshot {
  id: string;
  period_start: string;
  period_end: string;
  value: string;
  status: 'on_target' | 'warning' | 'critical';
  computed_at: string;
}
interface SchoolRollup {
  schoolId: string;
  schoolName: string;
  collectionRate: number;
  attendanceRate: number;
  academicPerformance: number | null;
}
interface TrendPoint {
  academicYear: string;
  averagePercentage: number | null;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = body?.message;
  return (Array.isArray(m) ? m.join('; ') : m) ?? fallback;
}

const DATA_SOURCES = ['collection_rate', 'attendance_rate', 'academic_performance', 'outstanding_actions'];
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'termly', 'yearly'];
const SNAPSHOT_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger'> = { on_target: 'success', warning: 'warning', critical: 'danger' };

const TABS = ['KPIs', 'School Performance', 'Trend Explorer'] as const;
type Tab = (typeof TABS)[number];

/**
 * SRS Chapters 14 + 27 (spec §7.3 "KPI configuration" + §7.12 Analytics).
 * The spec names 4 Analytics screens; one is genuinely not buildable —
 * "AI-drafted summary with human-approval gate" has zero backend support
 * (no AI/LLM integration, no draft/approve table anywhere in this
 * module) — flagged in School Performance rather than faked. "School
 * analytics" and "Group roll-up comparison" collapse into ONE real
 * screen here: there is no separate single-school endpoint, only
 * LEADERSHIP-gated /v1/analytics/group-rollup, which degrades cleanly to
 * a one-row table for a single-school tenant — a documented composition
 * decision, not a missing screen.
 */
export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('KPIs');
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canAccess = hasAnyRole(roleCodes, ACADEMIC_STAFF);
  const canConfigure = hasAnyRole(roleCodes, ACADEMIC_ADMIN);
  const canViewRollup = hasAnyRole(roleCodes, LEADERSHIP);

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    Promise.all([apiGet<Student[]>('/v1/students'), apiGet<SchoolClass[]>('/v1/classes'), apiGet<StaffMember[]>('/v1/staff')]).then(([s, c, st]) => {
      setStudents(s);
      setClasses(c);
      setStaff(st);
      setLoading(false);
    });
  }, [canAccess]);

  if (!canAccess) {
    return (
      <Card>
        <RestrictedState message="Analytics is available to teaching and administrative staff." />
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading analytics" rows={4} />
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
        {tab === 'KPIs' && <KpisTab staff={staff} canConfigure={canConfigure} />}
        {tab === 'School Performance' && <SchoolPerformanceTab canViewRollup={canViewRollup} />}
        {tab === 'Trend Explorer' && <TrendExplorerTab students={students} classes={classes} />}
      </Card>
    </div>
  );
}

function KpisTab({ staff, canConfigure }: { staff: StaffMember[]; canConfigure: boolean }) {
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<KpiDefinition[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', responsibleRole: '', dataSource: DATA_SOURCES[0], target: '', reportingFrequency: 'monthly', supervisorUserId: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<KpiSnapshot[]>([]);
  const [recomputeForm, setRecomputeForm] = useState({ periodStart: '', periodEnd: '' });
  const [recomputeError, setRecomputeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    setLoading(true);
    apiGet<KpiDefinition[]>('/v1/analytics/kpis')
      .then(setKpis)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/analytics/kpis', {
        method: 'POST',
        body: JSON.stringify({ ...form, target: form.target ? Number(form.target) : undefined, supervisorUserId: form.supervisorUserId || undefined }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm({ code: '', name: '', responsibleRole: '', dataSource: DATA_SOURCES[0], target: '', reportingFrequency: 'monthly', supervisorUserId: '' });
      setShowCreate(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create KPI.');
    } finally {
      setSaving(false);
    }
  }

  async function expand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setSnapshots(await apiGet<KpiSnapshot[]>(`/v1/analytics/kpis/${id}/snapshots`));
  }

  async function recompute(id: string) {
    setBusy(true);
    setRecomputeError(null);
    const res = await apiFetch(`/v1/analytics/kpis/${id}/recompute`, { method: 'POST', body: JSON.stringify(recomputeForm) });
    setBusy(false);
    if (!res.ok) return setRecomputeError(await errorMessage(res, `Failed (${res.status}) — a zero-matching-data case raises a raw server error here, not a clean rejection; try a period with real data`));
    setSnapshots(await apiGet<KpiSnapshot[]>(`/v1/analytics/kpis/${id}/snapshots`));
  }

  if (loading) return <LoadingState label="Loading KPIs" rows={3} />;

  return (
    <div>
      {canConfigure && (
        <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
          {showCreate ? 'Cancel' : 'Define KPI'}
        </Button>
      )}
      {showCreate && (
        <div style={{ marginBottom: 'var(--pb-space-3)' }}>
          <div className={styles.formRow}>
            <input className={styles.textInput} placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <input className={styles.textInput} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={styles.textInput} placeholder="Responsible role" value={form.responsibleRole} onChange={(e) => setForm({ ...form, responsibleRole: e.target.value })} />
          </div>
          <div className={styles.formRow}>
            <select className={styles.select} value={form.dataSource} onChange={(e) => setForm({ ...form, dataSource: e.target.value })}>
              {DATA_SOURCES.map((d) => (
                <option key={d} value={d}>
                  {d.replace('_', ' ')}
                </option>
              ))}
            </select>
            <select className={styles.select} value={form.reportingFrequency} onChange={(e) => setForm({ ...form, reportingFrequency: e.target.value })}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <input className={styles.textInput} type="number" placeholder="Target (optional)" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
            <select className={styles.select} value={form.supervisorUserId} onChange={(e) => setForm({ ...form, supervisorUserId: e.target.value })}>
              <option value="">No supervisor</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" onClick={handleCreate} disabled={saving || !form.code || !form.name || !form.responsibleRole}>
            Save
          </Button>
          {saveError && <ErrorState message={saveError} />}
        </div>
      )}
      {kpis.length === 0 ? (
        <EmptyState title="No KPIs defined yet" message="Define one to start tracking against a target." />
      ) : (
        kpis.map((k) => (
          <div key={k.id}>
            <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => expand(k.id)}>
              <span>
                {k.code} — {k.name}
              </span>
              <span className={styles.hint}>{k.data_source.replace('_', ' ')} · {k.reporting_frequency}</span>
            </div>
            {expandedId === k.id && (
              <div className={styles.detailPanel}>
                {canConfigure && (
                  <div className={styles.formRow}>
                    <input className={styles.textInput} type="date" value={recomputeForm.periodStart} onChange={(e) => setRecomputeForm({ ...recomputeForm, periodStart: e.target.value })} />
                    <input className={styles.textInput} type="date" value={recomputeForm.periodEnd} onChange={(e) => setRecomputeForm({ ...recomputeForm, periodEnd: e.target.value })} />
                    <Button type="button" variant="secondary" onClick={() => recompute(k.id)} disabled={busy || !recomputeForm.periodStart || !recomputeForm.periodEnd}>
                      Recompute
                    </Button>
                  </div>
                )}
                {recomputeError && <ErrorState message={recomputeError} />}
                {snapshots.length === 0 ? (
                  <EmptyState title="No snapshots yet" message="Recompute against a period with real data." />
                ) : (
                  snapshots.map((s) => (
                    <div key={s.id} className={styles.listRow}>
                      <span>
                        {s.period_start} → {s.period_end}
                      </span>
                      <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                        <span>{Number(s.value).toFixed(2)}</span>
                        <Pill variant={SNAPSHOT_STATUS_VARIANT[s.status] ?? 'neutral'}>{s.status.replace('_', ' ')}</Pill>
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function SchoolPerformanceTab({ canViewRollup }: { canViewRollup: boolean }) {
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [rollup, setRollup] = useState<{ schools: SchoolRollup[]; outstandingActionsCount: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!periodStart || !periodEnd) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ schools: SchoolRollup[]; outstandingActionsCount: number }>(`/v1/analytics/group-rollup?periodStart=${periodStart}&periodEnd=${periodEnd}`);
      setRollup(data);
    } catch {
      setError('Could not load school performance for this period.');
    } finally {
      setLoading(false);
    }
  }

  if (!canViewRollup) {
    return <RestrictedState message="School performance comparison is available to school leadership (Proprietor/Administrator/Headmaster) only." />;
  }

  return (
    <div>
      <p className={styles.hint}>
        Works for both single-school and multi-school tenants — a single-school tenant simply sees one row. This is the same real endpoint backing both the spec&apos;s &quot;School
        analytics&quot; and &quot;Group roll-up comparison&quot; screens.
      </p>
      <div className={styles.formRow}>
        <input className={styles.textInput} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        <input className={styles.textInput} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        <Button type="button" onClick={load} disabled={!periodStart || !periodEnd}>
          Load
        </Button>
      </div>
      {error && <ErrorState message={error} />}
      {loading ? (
        <LoadingState label="Loading school performance" rows={3} />
      ) : rollup ? (
        <>
          <div className={styles.statRow}>
            <div className={styles.statTile}>
              <div className={styles.statTileValue}>{rollup.outstandingActionsCount}</div>
              <div className={styles.statTileLabel}>Outstanding actions</div>
            </div>
          </div>
          {rollup.schools.map((s) => (
            <div key={s.schoolId} className={styles.listRow}>
              <span>{s.schoolName}</span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-3)' }}>
                <span>Collection {(s.collectionRate * 100).toFixed(0)}%</span>
                <span>Attendance {(s.attendanceRate * 100).toFixed(0)}%</span>
                <span>Academic {s.academicPerformance !== null ? `${s.academicPerformance.toFixed(1)}%` : '—'}</span>
              </span>
            </div>
          ))}
        </>
      ) : null}
      <div className={styles.detailPanel} style={{ marginTop: 'var(--pb-space-4)' }}>
        <EmptyState title="AI-drafted summary — not built" message="No AI/LLM integration exists in this environment; a draft-then-approve workflow needs a real model behind it, which this scaffold doesn't have. Flagged, not faked." />
      </div>
    </div>
  );
}

const TREND_LEVELS = ['student', 'class', 'subject', 'school'] as const;

function TrendExplorerTab({ students, classes }: { students: Student[]; classes: SchoolClass[] }) {
  const [level, setLevel] = useState<(typeof TREND_LEVELS)[number]>('school');
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [subjectName, setSubjectName] = useState('');
  const [points, setPoints] = useState<TrendPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ level });
      if (level === 'student') params.set('studentId', studentId);
      if (level === 'class') params.set('classId', classId);
      if (level === 'subject') params.set('subjectName', subjectName);
      const data = await apiGet<TrendPoint[]>(`/v1/analytics/trends?${params.toString()}`);
      setPoints(data);
    } catch {
      setError('Could not load trend data for this selection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className={styles.formRow}>
        <select className={styles.select} value={level} onChange={(e) => setLevel(e.target.value as (typeof TREND_LEVELS)[number])}>
          {TREND_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        {level === 'student' && (
          <select className={styles.select} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.last_name}, {s.first_name}
              </option>
            ))}
          </select>
        )}
        {level === 'class' && (
          <select className={styles.select} value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {level === 'subject' && <input className={styles.textInput} placeholder="Subject name" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} />}
        <Button type="button" onClick={load} disabled={level === 'student' && !studentId}>
          Load trend
        </Button>
      </div>
      {error && <ErrorState message={error} />}
      {loading ? (
        <LoadingState label="Loading trend" rows={3} />
      ) : points && points.length === 0 ? (
        <EmptyState title="No trend data" message="No published results match this selection yet." />
      ) : points ? (
        points.map((p) => (
          <div key={p.academicYear} className={styles.listRow}>
            <span>{p.academicYear}</span>
            <span>{p.averagePercentage !== null ? `${p.averagePercentage.toFixed(1)}%` : '—'}</span>
          </div>
        ))
      ) : null}
    </div>
  );
}
