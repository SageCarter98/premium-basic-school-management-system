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
import { AssessmentComponent, AssessmentStructure, Subject, componentTypeLabel } from '@/lib/assessment-roster';
import styles from './assessment.module.css';

interface SchoolClass {
  id: string;
  name: string;
}

interface AcademicYear {
  id: string;
  name: string;
}

const COMPONENT_TYPES = ['class_exercise', 'homework', 'project', 'mid_term', 'end_of_term_exam'];

/**
 * SRS Chapter 19 (spec §7.8's "Assessment configuration & weighting").
 * Structure list + a detail panel (no nested route — a class only ever
 * has a handful of structures, one per subject+year, so a client-side
 * selection is simpler than a second route). Publication is blocked
 * client-side whenever the weight sum isn't exactly 100, mirroring the
 * spec §8.3 weighting-bar behaviour — the REAL enforcement is still
 * server-side (assessment.service.ts's publish()); this is the same
 * "declutter, never authorize" posture as every other role-gated control
 * in this app.
 */
export default function AssessmentPage() {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canConfigure = hasAnyRole(roleCodes, ACADEMIC_ADMIN);

  const [loading, setLoading] = useState(true);
  const [structures, setStructures] = useState<AssessmentStructure[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ classId: '', subjectId: '', academicYearId: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    Promise.all([
      apiGet<AssessmentStructure[]>('/v1/assessment/structures'),
      apiGet<SchoolClass[]>('/v1/classes'),
      apiGet<Subject[]>('/v1/assessment/subjects'),
      apiGet<AcademicYear[]>('/v1/academic-years'),
    ]).then(([st, c, s, y]) => {
      setStructures(st);
      setClasses(c);
      setSubjects(s);
      setYears(y);
      setCreateForm((f) => ({
        classId: f.classId || c[0]?.id || '',
        subjectId: f.subjectId || s[0]?.id || '',
        academicYearId: f.academicYearId || y[0]?.id || '',
      }));
      setLoading(false);
    });
  }
  useEffect(reload, []);

  async function handleCreateStructure() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/assessment/structures', { method: 'POST', body: JSON.stringify(createForm) });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      const created = (await res.json()) as AssessmentStructure;
      setShowCreate(false);
      reload();
      setSelectedId(created.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create structure.');
    } finally {
      setSaving(false);
    }
  }

  function classLabel(s: AssessmentStructure): string {
    const cls = classes.find((c) => c.id === s.class_id)?.name ?? s.class_id;
    const subj = subjects.find((sub) => sub.id === s.subject_id)?.name ?? s.subject_id;
    const yr = years.find((y) => y.id === s.academic_year_id)?.name ?? s.academic_year_id;
    return `${subj} · ${cls} · ${yr}`;
  }

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading assessment structures" rows={4} />
      </Card>
    );
  }

  return (
    <div>
      <Card style={{ padding: 'var(--pb-space-4)', marginBottom: 'var(--pb-space-3)' }}>
        {canConfigure && (
          <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
            {showCreate ? 'Cancel' : 'Add assessment structure'}
          </Button>
        )}
        {showCreate && (
          <div className={styles.formRow}>
            <select className={styles.select} value={createForm.subjectId} onChange={(e) => setCreateForm({ ...createForm, subjectId: e.target.value })}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select className={styles.select} value={createForm.classId} onChange={(e) => setCreateForm({ ...createForm, classId: e.target.value })}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select className={styles.select} value={createForm.academicYearId} onChange={(e) => setCreateForm({ ...createForm, academicYearId: e.target.value })}>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </select>
            <Button type="button" onClick={handleCreateStructure} disabled={saving || !createForm.classId || !createForm.subjectId || !createForm.academicYearId}>
              Save
            </Button>
          </div>
        )}
        {saveError && <ErrorState message={saveError} />}

        {structures.length === 0 ? (
          <EmptyState title="No assessment structures yet" message="Add one for a class+subject+year to start entering scores." />
        ) : (
          structures.map((s) => (
            <div
              key={s.id}
              className={[styles.listRow, s.id === selectedId ? styles.listRowActive : ''].filter(Boolean).join(' ')}
              onClick={() => setSelectedId(s.id)}
            >
              <span>{classLabel(s)}</span>
              <Pill variant={s.status === 'published' ? 'success' : 'neutral'}>{s.status}</Pill>
            </div>
          ))
        )}
      </Card>

      {selectedId && <StructureDetail structureId={selectedId} label={classLabel(structures.find((s) => s.id === selectedId)!)} canConfigure={canConfigure} onChanged={reload} />}
    </div>
  );
}

function StructureDetail({
  structureId,
  label,
  canConfigure,
  onChanged,
}: {
  structureId: string;
  label: string;
  canConfigure: boolean;
  onChanged: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [structure, setStructure] = useState<AssessmentStructure | null>(null);
  const [components, setComponents] = useState<AssessmentComponent[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ componentType: COMPONENT_TYPES[0], weight: '', maxScore: '100' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    Promise.all([apiGet<AssessmentStructure>(`/v1/assessment/structures/${structureId}`), apiGet<AssessmentComponent[]>(`/v1/assessment/structures/${structureId}/components`)])
      .then(([s, c]) => {
        setStructure(s);
        setComponents(c);
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, [structureId]);

  const totalWeight = useMemo(() => components.reduce((sum, c) => sum + Number(c.weight), 0), [components]);
  const weightOk = Math.abs(totalWeight - 100) < 0.01;

  async function handleAddComponent() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/v1/assessment/structures/${structureId}/components`, {
        method: 'POST',
        body: JSON.stringify({ componentType: form.componentType, weight: Number(form.weight), maxScore: Number(form.maxScore) }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      setShowAdd(false);
      setForm({ componentType: COMPONENT_TYPES[0], weight: '', maxScore: '100' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add component.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setError(null);
    const res = await apiFetch(`/v1/assessment/structures/${structureId}/publish`, { method: 'POST' });
    if (!res.ok) {
      setError(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      return;
    }
    reload();
    onChanged();
  }

  async function handleReopen() {
    const reason = window.prompt('Reason for reopening this structure (required):');
    if (!reason) return;
    setError(null);
    const res = await apiFetch(`/v1/assessment/structures/${structureId}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) });
    if (!res.ok) {
      setError(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      return;
    }
    reload();
    onChanged();
  }

  if (loading || !structure) {
    return (
      <Card style={{ padding: 'var(--pb-space-4)' }}>
        <LoadingState label="Loading structure" rows={3} />
      </Card>
    );
  }

  const isDraft = structure.status === 'draft';

  return (
    <Card style={{ padding: 'var(--pb-space-4)' }}>
      <div className={styles.detailHeader}>
        <div>
          <strong>{label}</strong>
          <div>
            <Pill variant={structure.status === 'published' ? 'success' : 'neutral'}>{structure.status}</Pill>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--pb-space-2)' }}>
          <Link href={`/assessment/${structureId}`}>
            <Button type="button" variant="secondary">
              Enter scores
            </Button>
          </Link>
          {canConfigure &&
            (isDraft ? (
              <Button type="button" onClick={handlePublish} disabled={!weightOk}>
                Publish
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={handleReopen}>
                Request reopen
              </Button>
            ))}
        </div>
      </div>

      {!weightOk && isDraft && (
        <p style={{ color: 'var(--pb-danger)', fontSize: 'var(--pb-text-small)', marginBottom: 'var(--pb-space-2)' }}>
          Publish is blocked — component weights sum to {totalWeight.toFixed(2)}%, not 100%.
        </p>
      )}
      <div className={styles.weightBar}>
        <div className={[styles.weightFill, totalWeight > 100 ? styles.weightFillOver : ''].filter(Boolean).join(' ')} style={{ width: `${Math.min(100, totalWeight)}%` }} />
      </div>
      <div className={styles.weightLine}>
        <span>Weight total</span>
        <span>{totalWeight.toFixed(2)}% of 100%</span>
      </div>

      {error && <ErrorState message={error} />}

      {components.length === 0 ? (
        <EmptyState title="No components yet" message="Add at least one graded component before scores can be entered." />
      ) : (
        components.map((c) => (
          <div key={c.id} className={styles.listRow} style={{ cursor: 'default' }}>
            <span>{componentTypeLabel(c.component_type)}</span>
            <span style={{ color: 'var(--pb-ink-muted)' }}>
              {c.weight}% · out of {c.max_score}
            </span>
          </div>
        ))
      )}

      {canConfigure && isDraft && (
        <div style={{ marginTop: 'var(--pb-space-3)' }}>
          <Button type="button" variant="secondary" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? 'Cancel' : 'Add component'}
          </Button>
          {showAdd && (
            <div className={styles.formRow} style={{ marginTop: 'var(--pb-space-3)' }}>
              <select className={styles.select} value={form.componentType} onChange={(e) => setForm({ ...form, componentType: e.target.value })}>
                {COMPONENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {componentTypeLabel(t)}
                  </option>
                ))}
              </select>
              <input className={styles.textInput} type="number" placeholder="Weight %" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
              <input className={styles.textInput} type="number" placeholder="Max score" value={form.maxScore} onChange={(e) => setForm({ ...form, maxScore: e.target.value })} />
              <Button type="button" onClick={handleAddComponent} disabled={saving || !form.weight}>
                Save
              </Button>
            </div>
          )}
        </div>
      )}

      {structure.status === 'published' && <GradingSection structureId={structureId} canConfigure={canConfigure} />}
    </Card>
  );
}

interface GradingPolicySummary {
  id: string;
  name: string;
  status: string;
}

interface ResultCandidate {
  id: string;
  student_id: string;
  percentage: string;
  grade: string;
  is_pass: boolean;
  rank: number | null;
}

const RANK_MODES = ['competition', 'dense', 'none'];

/**
 * SRS Chapter 20 (FR-GRA-040..050). Only shown once the structure is
 * published — compute() reads scores that are locked at that point, so
 * offering this against a draft structure would just error, per
 * grading.service.ts's own header comment on why the engine never
 * touches scores directly.
 */
function GradingSection({ structureId, canConfigure }: { structureId: string; canConfigure: boolean }) {
  const [policies, setPolicies] = useState<GradingPolicySummary[]>([]);
  const [policyId, setPolicyId] = useState('');
  const [rankMode, setRankMode] = useState(RANK_MODES[0]);
  const [results, setResults] = useState<ResultCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    Promise.all([apiGet<GradingPolicySummary[]>('/v1/grading/policies'), apiGet<ResultCandidate[]>(`/v1/grading/structures/${structureId}/results`)]).then(([p, r]) => {
      const active = p.filter((policy) => policy.status === 'active');
      setPolicies(active);
      setPolicyId((prev) => prev || active[0]?.id || '');
      setResults(r);
    });
  }
  useEffect(reload, [structureId]);

  async function handleCompute() {
    if (!policyId) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/grading/structures/${structureId}/compute`, { method: 'POST', body: JSON.stringify({ gradingPolicyId: policyId }) });
    if (!res.ok) {
      setError(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
    } else {
      reload();
    }
    setBusy(false);
  }

  async function handleRank() {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/grading/structures/${structureId}/rank`, { method: 'POST', body: JSON.stringify({ mode: rankMode }) });
    if (!res.ok) {
      setError(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
    } else {
      reload();
    }
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 'var(--pb-space-5)', borderTop: '1px solid var(--pb-rule)', paddingTop: 'var(--pb-space-4)' }}>
      <strong>Grading</strong>
      {canConfigure && (
        <div className={styles.formRow} style={{ marginTop: 'var(--pb-space-3)' }}>
          <select className={styles.select} value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
            {policies.length === 0 && <option value="">No active policy</option>}
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button type="button" onClick={handleCompute} disabled={busy || !policyId}>
            Compute
          </Button>
          <select className={styles.select} value={rankMode} onChange={(e) => setRankMode(e.target.value)}>
            {RANK_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={handleRank} disabled={busy || results.length === 0}>
            Rank
          </Button>
        </div>
      )}
      {error && <ErrorState message={error} />}
      {results.length === 0 ? (
        <EmptyState title="Not computed yet" message="Pick a policy and compute results for this structure's roster." />
      ) : (
        results
          .slice()
          .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
          .map((r) => (
            <div key={r.id} className={styles.listRow} style={{ cursor: 'default' }}>
              <span>
                {r.rank ? `#${r.rank} ` : ''}
                {r.student_id.slice(0, 8)}… — {Number(r.percentage).toFixed(1)}%
              </span>
              <Pill variant={r.is_pass ? 'success' : 'danger'}>{r.grade}</Pill>
            </div>
          ))
      )}
    </div>
  );
}
