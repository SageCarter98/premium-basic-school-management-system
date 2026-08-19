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
import { INVENTORY_TEAM, hasAnyRole } from '@/lib/role-groups';
import styles from '@/styles/tab-hub.module.css';

interface Student {
  id: string;
  first_name: string;
  last_name: string;
}
interface StaffMember {
  id: string;
  full_name: string;
}
interface InventoryItem {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  quantity_on_hand: number;
  reorder_threshold: number;
}
interface InventoryIssuance {
  id: string;
  item_id: string;
  issued_to_type: string;
  issued_to_id: string;
  quantity: number;
  issued_by: string;
  issued_at: string;
  purpose: string | null;
}
interface InventoryAlert {
  id: string;
  item_id: string;
  quantity_on_hand: number;
  reorder_threshold: number;
  notification_id: string | null;
  created_at: string;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = body?.message;
  return (Array.isArray(m) ? m.join('; ') : m) ?? fallback;
}

const TABS = ['Items', 'Issue Stock', 'Alerts'] as const;
type Tab = (typeof TABS)[number];

/** SRS Chapter 28 (spec §7.13 "Inventory — assets, stock, issuance, low-stock alerts"). Assets and consumable stock share one `inventory_items` table — no separate asset-tracking distinction in the backend. */
export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>('Items');
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canAccess = hasAnyRole(roleCodes, INVENTORY_TEAM);

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);

  function reloadItems() {
    return apiGet<InventoryItem[]>('/v1/inventory/items').then(setItems);
  }

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    Promise.all([apiGet<Student[]>('/v1/students'), apiGet<StaffMember[]>('/v1/staff'), reloadItems()]).then(([s, st]) => {
      setStudents(s);
      setStaff(st);
      setLoading(false);
    });
  }, [canAccess]);

  if (!canAccess) {
    return (
      <Card>
        <RestrictedState message="Inventory is available to the storekeeper and leadership roles only." />
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading inventory" rows={4} />
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
        {tab === 'Items' && <ItemsTab items={items} onChanged={reloadItems} />}
        {tab === 'Issue Stock' && <IssueStockTab items={items} students={students} staff={staff} onChanged={reloadItems} />}
        {tab === 'Alerts' && <AlertsTab items={items} />}
      </Card>
    </div>
  );
}

function ItemsTab({ items, onChanged }: { items: InventoryItem[]; onChanged: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', category: '', unit: 'each', quantityOnHand: '0', reorderThreshold: '5' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/v1/inventory/items', {
        method: 'POST',
        body: JSON.stringify({ name: form.name, category: form.category || undefined, unit: form.unit, quantityOnHand: Number(form.quantityOnHand), reorderThreshold: Number(form.reorderThreshold) }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm({ name: '', category: '', unit: 'each', quantityOnHand: '0', reorderThreshold: '5' });
      setShowCreate(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add item.');
    } finally {
      setSaving(false);
    }
  }

  async function receive(id: string) {
    const qty = Number(receiveQty[id]);
    if (!qty || qty <= 0) return;
    setBusy(true);
    await apiFetch(`/v1/inventory/items/${id}/receive`, { method: 'POST', body: JSON.stringify({ quantity: qty }) });
    setBusy(false);
    setReceiveQty((r) => ({ ...r, [id]: '' }));
    onChanged();
  }

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showCreate ? 'Cancel' : 'Add item'}
      </Button>
      {showCreate && (
        <div className={styles.formRow}>
          <input className={styles.textInput} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={styles.textInput} placeholder="Category (optional)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input className={styles.textInput} placeholder="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <input className={styles.textInput} type="number" min="0" placeholder="Starting quantity" value={form.quantityOnHand} onChange={(e) => setForm({ ...form, quantityOnHand: e.target.value })} />
          <input className={styles.textInput} type="number" min="0" placeholder="Reorder threshold" value={form.reorderThreshold} onChange={(e) => setForm({ ...form, reorderThreshold: e.target.value })} />
          <Button type="button" onClick={handleCreate} disabled={saving || !form.name}>
            Save
          </Button>
        </div>
      )}
      {error && <ErrorState message={error} />}
      {items.length === 0 ? (
        <EmptyState title="No inventory items yet" message="Add one to start tracking stock." />
      ) : (
        items.map((i) => (
          <div key={i.id} className={styles.listRow}>
            <span>
              {i.name}
              {i.category && <> · {i.category}</>}
            </span>
            <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
              <Pill variant={i.quantity_on_hand <= i.reorder_threshold ? 'danger' : 'success'}>
                {i.quantity_on_hand} {i.unit} on hand
              </Pill>
              <input className={styles.numInput} type="number" min="1" placeholder="Qty" value={receiveQty[i.id] ?? ''} onChange={(e) => setReceiveQty((r) => ({ ...r, [i.id]: e.target.value }))} />
              <Button type="button" variant="secondary" onClick={() => receive(i.id)} disabled={busy}>
                Receive
              </Button>
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function IssueStockTab({ items, students, staff, onChanged }: { items: InventoryItem[]; students: Student[]; staff: StaffMember[]; onChanged: () => void }) {
  const userId = decodeAccessToken()?.sub ?? '';
  const [loading, setLoading] = useState(true);
  const [issuances, setIssuances] = useState<InventoryIssuance[]>([]);
  const [form, setForm] = useState({ itemId: '', issuedToType: 'student' as 'student' | 'staff', issuedToId: '', quantity: '1', purpose: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<InventoryIssuance[]>('/v1/inventory/issuances')
      .then(setIssuances)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  function recipientOptions() {
    return form.issuedToType === 'student' ? students.map((s) => ({ id: s.id, label: `${s.last_name}, ${s.first_name}` })) : staff.map((s) => ({ id: s.id, label: s.full_name }));
  }

  function recipientLabel(type: string, id: string): string {
    if (type === 'student') {
      const s = students.find((x) => x.id === id);
      return s ? `${s.last_name}, ${s.first_name}` : id.slice(0, 8) + '…';
    }
    const st = staff.find((x) => x.id === id);
    return st ? st.full_name : id.slice(0, 8) + '…';
  }

  async function issue() {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/inventory/items/${form.itemId}/issue`, {
      method: 'POST',
      body: JSON.stringify({ issuedToType: form.issuedToType, issuedToId: form.issuedToId, quantity: Number(form.quantity), issuedBy: userId, purpose: form.purpose || undefined }),
    });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setForm({ itemId: '', issuedToType: 'student', issuedToId: '', quantity: '1', purpose: '' });
    reload();
    onChanged();
  }

  if (loading) return <LoadingState label="Loading issuances" rows={3} />;

  return (
    <div>
      <div className={styles.formRow}>
        <select className={styles.select} value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}>
          <option value="">Choose an item</option>
          {items.filter((i) => i.quantity_on_hand > 0).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.quantity_on_hand} on hand)
            </option>
          ))}
        </select>
        <select className={styles.select} value={form.issuedToType} onChange={(e) => setForm({ ...form, issuedToType: e.target.value as 'student' | 'staff', issuedToId: '' })}>
          <option value="student">Student</option>
          <option value="staff">Staff</option>
        </select>
        <select className={styles.select} value={form.issuedToId} onChange={(e) => setForm({ ...form, issuedToId: e.target.value })}>
          <option value="">Choose a recipient</option>
          {recipientOptions().map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <input className={styles.textInput} type="number" min="1" placeholder="Quantity" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        <input className={styles.textInput} placeholder="Purpose (optional)" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        <Button type="button" onClick={issue} disabled={busy || !form.itemId || !form.issuedToId}>
          Issue
        </Button>
      </div>
      <p className={styles.hint}>An issuance that drops quantity to or below the reorder threshold raises a low-stock alert automatically (see the Alerts tab).</p>
      {error && <ErrorState message={error} />}
      {issuances.length === 0 ? (
        <EmptyState title="No issuances yet" message="Issue stock above." />
      ) : (
        issuances
          .slice()
          .reverse()
          .map((iss) => (
            <div key={iss.id} className={styles.listRow}>
              <span>
                {items.find((i) => i.id === iss.item_id)?.name ?? iss.item_id} × {iss.quantity} — {recipientLabel(iss.issued_to_type, iss.issued_to_id)}
                {iss.purpose && <> · {iss.purpose}</>}
              </span>
              <span className={styles.hint}>{new Date(iss.issued_at).toLocaleDateString()}</span>
            </div>
          ))
      )}
    </div>
  );
}

function AlertsTab({ items }: { items: InventoryItem[] }) {
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);

  useEffect(() => {
    apiGet<InventoryAlert[]>('/v1/inventory/alerts')
      .then(setAlerts)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState label="Loading alerts" rows={3} />;

  return (
    <div>
      {alerts.length === 0 ? (
        <EmptyState title="No low-stock alerts" message="Alerts appear here when an issuance drops an item to or below its reorder threshold." />
      ) : (
        alerts.map((a) => (
          <div key={a.id} className={styles.listRow}>
            <span>{items.find((i) => i.id === a.item_id)?.name ?? a.item_id}</span>
            <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
              <Pill variant="danger">
                {a.quantity_on_hand} ≤ {a.reorder_threshold}
              </Pill>
              <span className={styles.hint}>{new Date(a.created_at).toLocaleDateString()}</span>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
