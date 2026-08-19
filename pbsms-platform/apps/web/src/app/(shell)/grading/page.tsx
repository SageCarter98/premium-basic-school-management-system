'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { apiFetch, apiGet } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { ACADEMIC_ADMIN, hasAnyRole } from '@/lib/role-groups';
import styles from './grading.module.css';

interface GradingPolicy {
  id: string;
  name: string;
  applicability: string;
  version: number;
  status: string;
}

interface GradingScaleItem {
  id: string;
  min_value: string;
  max_value: string;
  grade: string;
  point: string | null;
  remark: string | null;
  is_pass: boolean;
}

const APPLICABILITIES = ['numerical', 'developmental', 'nacca_competency'];

/**
 * SRS Chapter 20 (spec §7.8's "Grading scale & policy versions"). Rarely
 * touched once set up — a genuine settings screen, not a daily-use one —
 * so this stays a straightforward list+detail rather than anything
 * spreadsheet-grade. The compute/rank step lives on the Assessment
 * structure detail screen instead of here, since it's scoped to one
 * structure, not to policy configuration.
 */
export default function GradingPage() {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canConfigure = hasAnyRole(roleCodes, ACADEMIC_ADMIN);

  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState<GradingPolicy[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', applicability: APPLICABILITIES[0] });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<GradingPolicy[]>('/v1/grading/policies')
      .then(setPolicies)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/grading/policies', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      const created = (await res.json()) as GradingPolicy;
      setForm({ name: '', applicability: APPLICABILITIES[0] });
      setShowCreate(false);
      reload();
      setSelectedId(created.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create policy.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading grading policies" rows={3} />
      </Card>
    );
  }

  return (
    <div>
      <Card style={{ padding: 'var(--pb-space-4)', marginBottom: 'var(--pb-space-3)' }}>
        {canConfigure && (
          <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
            {showCreate ? 'Cancel' : 'Add grading policy'}
          </Button>
        )}
        {showCreate && (
          <div className={styles.formRow}>
            <input className={styles.textInput} placeholder="Name, e.g. JHS Numerical 2026" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className={styles.select} value={form.applicability} onChange={(e) => setForm({ ...form, applicability: e.target.value })}>
              {APPLICABILITIES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <Button type="button" onClick={handleCreate} disabled={saving || !form.name}>
              Save
            </Button>
          </div>
        )}
        {saveError && <ErrorState message={saveError} />}
        {policies.length === 0 ? (
          <EmptyState title="No grading policies yet" message="Add one before computing results for any assessment structure." />
        ) : (
          policies.map((p) => (
            <div key={p.id} className={[styles.listRow, p.id === selectedId ? styles.listRowActive : ''].filter(Boolean).join(' ')} onClick={() => setSelectedId(p.id)}>
              <span>
                {p.name} <span style={{ color: 'var(--pb-ink-muted)' }}>v{p.version} · {p.applicability}</span>
              </span>
              <Pill variant={p.status === 'active' ? 'success' : p.status === 'retired' ? 'neutral' : 'warning'}>{p.status}</Pill>
            </div>
          ))
        )}
      </Card>

      {selectedId && <PolicyDetail policyId={selectedId} canConfigure={canConfigure} onChanged={reload} />}
    </div>
  );
}

function PolicyDetail({ policyId, canConfigure, onChanged }: { policyId: string; canConfigure: boolean; onChanged: () => void }) {
  const [loading, setLoading] = useState(true);
  const [policy, setPolicy] = useState<GradingPolicy | null>(null);
  const [items, setItems] = useState<GradingScaleItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ minValue: '', maxValue: '', grade: '', point: '', remark: '', isPass: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    Promise.all([apiGet<GradingPolicy>(`/v1/grading/policies/${policyId}`), apiGet<GradingScaleItem[]>(`/v1/grading/policies/${policyId}/scale-items`)])
      .then(([p, i]) => {
        setPolicy(p);
        setItems(i);
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, [policyId]);

  async function handleAddItem() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/v1/grading/policies/${policyId}/scale-items`, {
        method: 'POST',
        body: JSON.stringify({
          minValue: Number(form.minValue),
          maxValue: Number(form.maxValue),
          grade: form.grade,
          point: form.point ? Number(form.point) : undefined,
          remark: form.remark || undefined,
          isPass: form.isPass,
        }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      setForm({ minValue: '', maxValue: '', grade: '', point: '', remark: '', isPass: true });
      setShowAdd(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add scale item.');
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    setError(null);
    const res = await apiFetch(`/v1/grading/policies/${policyId}/activate`, { method: 'POST' });
    if (!res.ok) {
      setError(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      return;
    }
    reload();
    onChanged();
  }

  async function handleRetire() {
    setError(null);
    const res = await apiFetch(`/v1/grading/policies/${policyId}/retire`, { method: 'POST' });
    if (!res.ok) {
      setError(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`);
      return;
    }
    reload();
    onChanged();
  }

  if (loading || !policy) {
    return (
      <Card style={{ padding: 'var(--pb-space-4)' }}>
        <LoadingState label="Loading scale items" rows={3} />
      </Card>
    );
  }

  return (
    <Card style={{ padding: 'var(--pb-space-4)' }}>
      <div className={styles.detailHeader}>
        <strong>
          {policy.name} <span style={{ color: 'var(--pb-ink-muted)', fontWeight: 400 }}>v{policy.version}</span>
        </strong>
        {canConfigure && (
          <div style={{ display: 'flex', gap: 'var(--pb-space-2)' }}>
            {policy.status === 'draft' && (
              <Button type="button" onClick={handleActivate}>
                Activate
              </Button>
            )}
            {policy.status === 'active' && (
              <Button type="button" variant="secondary" onClick={handleRetire}>
                Retire
              </Button>
            )}
          </div>
        )}
      </div>
      {error && <ErrorState message={error} />}

      {items.length === 0 ? (
        <EmptyState title="No scale items" message="Coverage must chain from exactly 0 to exactly 100 before this policy can be activated." />
      ) : (
        items.map((item) => (
          <div key={item.id} className={styles.listRow} style={{ cursor: 'default' }}>
            <span>
              {item.min_value}–{item.max_value}: <strong>{item.grade}</strong> {item.remark ? `(${item.remark})` : ''}
            </span>
            <Pill variant={item.is_pass ? 'success' : 'danger'}>{item.is_pass ? 'Pass' : 'Fail'}</Pill>
          </div>
        ))
      )}

      {canConfigure && policy.status === 'draft' && (
        <div style={{ marginTop: 'var(--pb-space-3)' }}>
          <Button type="button" variant="secondary" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? 'Cancel' : 'Add scale item'}
          </Button>
          {showAdd && (
            <div className={styles.formRow} style={{ marginTop: 'var(--pb-space-3)' }}>
              <input className={styles.textInput} type="number" placeholder="Min %" value={form.minValue} onChange={(e) => setForm({ ...form, minValue: e.target.value })} />
              <input className={styles.textInput} type="number" placeholder="Max %" value={form.maxValue} onChange={(e) => setForm({ ...form, maxValue: e.target.value })} />
              <input className={styles.textInput} placeholder="Grade, e.g. A1" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
              <input className={styles.textInput} placeholder="Remark" value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--pb-space-1)', fontSize: 'var(--pb-text-small)' }}>
                <input type="checkbox" checked={form.isPass} onChange={(e) => setForm({ ...form, isPass: e.target.checked })} />
                Pass
              </label>
              <Button type="button" onClick={handleAddItem} disabled={saving || !form.minValue || !form.maxValue || !form.grade}>
                Save
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
