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
import { LIBRARY_TEAM, hasAnyRole } from '@/lib/role-groups';
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
interface LibraryItem {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  category: string | null;
  total_copies: number;
  available_copies: number;
}
interface LibraryMember {
  id: string;
  student_id: string | null;
  staff_user_id: string | null;
}
interface LibraryLoan {
  id: string;
  item_id: string;
  member_id: string;
  issued_at: string;
  due_date: string;
  returned_at: string | null;
  renewal_count: number;
  fine_amount: string;
  fine_paid: boolean;
  status: string;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = body?.message;
  return (Array.isArray(m) ? m.join('; ') : m) ?? fallback;
}

const TABS = ['Catalogue', 'Members', 'Loans'] as const;
type Tab = (typeof TABS)[number];

/** SRS Chapter 28 (spec §7.13 "Library — catalogue, circulation, fines"). */
export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>('Catalogue');
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canAccess = hasAnyRole(roleCodes, LIBRARY_TEAM);

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [members, setMembers] = useState<LibraryMember[]>([]);

  function reloadShared() {
    return Promise.all([
      apiGet<Student[]>('/v1/students'),
      apiGet<StaffMember[]>('/v1/staff'),
      apiGet<LibraryItem[]>('/v1/library/items'),
      apiGet<LibraryMember[]>('/v1/library/members'),
    ]).then(([s, st, i, m]) => {
      setStudents(s);
      setStaff(st);
      setItems(i);
      setMembers(m);
    });
  }

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    reloadShared().finally(() => setLoading(false));
  }, [canAccess]);

  if (!canAccess) {
    return (
      <Card>
        <RestrictedState message="Library is available to the school librarian and leadership roles only." />
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading library" rows={4} />
      </Card>
    );
  }

  function memberLabel(m: LibraryMember): string {
    if (m.student_id) {
      const s = students.find((x) => x.id === m.student_id);
      return s ? `${s.last_name}, ${s.first_name} (student)` : `${m.student_id.slice(0, 8)}… (student)`;
    }
    const st = staff.find((x) => x.id === m.staff_user_id);
    return st ? `${st.full_name} (staff)` : `${m.staff_user_id?.slice(0, 8)}… (staff)`;
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
        {tab === 'Catalogue' && <CatalogueTab items={items} onChanged={reloadShared} />}
        {tab === 'Members' && <MembersTab members={members} students={students} staff={staff} memberLabel={memberLabel} onChanged={reloadShared} />}
        {tab === 'Loans' && <LoansTab items={items} members={members} memberLabel={memberLabel} />}
      </Card>
    </div>
  );
}

function CatalogueTab({ items, onChanged }: { items: LibraryItem[]; onChanged: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', author: '', isbn: '', category: '', totalCopies: '1' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/v1/library/items', {
        method: 'POST',
        body: JSON.stringify({ title: form.title, author: form.author || undefined, isbn: form.isbn || undefined, category: form.category || undefined, totalCopies: Number(form.totalCopies) }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm({ title: '', author: '', isbn: '', category: '', totalCopies: '1' });
      setShowCreate(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add item.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showCreate ? 'Cancel' : 'Add catalogue item'}
      </Button>
      {showCreate && (
        <div className={styles.formRow}>
          <input className={styles.textInput} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className={styles.textInput} placeholder="Author" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
          <input className={styles.textInput} placeholder="ISBN" value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} />
          <input className={styles.textInput} placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input className={styles.textInput} type="number" min="0" placeholder="Copies" value={form.totalCopies} onChange={(e) => setForm({ ...form, totalCopies: e.target.value })} />
          <Button type="button" onClick={handleCreate} disabled={saving || !form.title}>
            Save
          </Button>
        </div>
      )}
      {error && <ErrorState message={error} />}
      {items.length === 0 ? (
        <EmptyState title="No catalogue items yet" message="Add a book to start circulation." />
      ) : (
        items.map((i) => (
          <div key={i.id} className={styles.listRow}>
            <span>
              {i.title}
              {i.author && <> — {i.author}</>}
              {i.category && <> · {i.category}</>}
            </span>
            <Pill variant={i.available_copies > 0 ? 'success' : 'danger'}>
              {i.available_copies}/{i.total_copies} available
            </Pill>
          </div>
        ))
      )}
    </div>
  );
}

function MembersTab({
  members,
  students,
  staff,
  memberLabel,
  onChanged,
}: {
  members: LibraryMember[];
  students: Student[];
  staff: StaffMember[];
  memberLabel: (m: LibraryMember) => string;
  onChanged: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [kind, setKind] = useState<'student' | 'staff'>('student');
  const [entityId, setEntityId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const body = kind === 'student' ? { studentId: entityId } : { staffUserId: entityId };
      const res = await apiFetch('/v1/library/members', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setEntityId('');
      setShowCreate(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enrol member.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showCreate ? 'Cancel' : 'Enrol member'}
      </Button>
      {showCreate && (
        <div className={styles.formRow}>
          <select className={styles.select} value={kind} onChange={(e) => { setKind(e.target.value as 'student' | 'staff'); setEntityId(''); }}>
            <option value="student">Student</option>
            <option value="staff">Staff</option>
          </select>
          <select className={styles.select} value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">Choose one</option>
            {(kind === 'student' ? students.map((s) => ({ id: s.id, label: `${s.last_name}, ${s.first_name}` })) : staff.map((s) => ({ id: s.id, label: s.full_name }))).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <Button type="button" onClick={handleCreate} disabled={saving || !entityId}>
            Save
          </Button>
        </div>
      )}
      {error && <ErrorState message={error} />}
      {members.length === 0 ? (
        <EmptyState title="No members enrolled yet" message="Enrol a student or staff member before issuing loans." />
      ) : (
        members.map((m) => (
          <div key={m.id} className={styles.listRow}>
            <span>{memberLabel(m)}</span>
          </div>
        ))
      )}
    </div>
  );
}

function LoansTab({ items, members, memberLabel }: { items: LibraryItem[]; members: LibraryMember[]; memberLabel: (m: LibraryMember) => string }) {
  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState<LibraryLoan[]>([]);
  const [showIssue, setShowIssue] = useState(false);
  const [form, setForm] = useState({ itemId: '', memberId: '', dueDate: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<LibraryLoan[]>('/v1/library/loans')
      .then(setLoans)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function issue() {
    setBusy(true);
    setError(null);
    const res = await apiFetch('/v1/library/loans', { method: 'POST', body: JSON.stringify(form) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setForm({ itemId: '', memberId: '', dueDate: '' });
    setShowIssue(false);
    reload();
  }

  async function act(id: string, action: 'renew' | 'return' | 'pay-fine') {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/library/loans/${id}/${action}`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
  }

  if (loading) return <LoadingState label="Loading loans" rows={3} />;

  const isOverdue = (l: LibraryLoan) => l.status === 'on_loan' && l.due_date < new Date().toISOString().slice(0, 10);

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowIssue((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showIssue ? 'Cancel' : 'Issue loan'}
      </Button>
      {showIssue && (
        <div className={styles.formRow}>
          <select className={styles.select} value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}>
            <option value="">Choose an item</option>
            {items.filter((i) => i.available_copies > 0).map((i) => (
              <option key={i.id} value={i.id}>
                {i.title} ({i.available_copies} available)
              </option>
            ))}
          </select>
          <select className={styles.select} value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
            <option value="">Choose a member</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {memberLabel(m)}
              </option>
            ))}
          </select>
          <input className={styles.textInput} type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          <Button type="button" onClick={issue} disabled={busy || !form.itemId || !form.memberId || !form.dueDate}>
            Issue
          </Button>
        </div>
      )}
      {error && <ErrorState message={error} />}
      {loans.length === 0 ? (
        <EmptyState title="No loans yet" message="Issue one from the catalogue above." />
      ) : (
        loans.map((l) => (
          <div key={l.id} className={styles.listRow}>
            <span>
              {items.find((i) => i.id === l.item_id)?.title ?? l.item_id} — {memberLabel(members.find((m) => m.id === l.member_id) ?? ({ id: l.member_id, student_id: null, staff_user_id: null } as LibraryMember))}
              {' · due '}
              {l.due_date}
              {l.renewal_count > 0 && <> · renewed ×{l.renewal_count}</>}
            </span>
            <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
              {Number(l.fine_amount) > 0 && <Pill variant={l.fine_paid ? 'success' : 'danger'}>{l.fine_paid ? 'fine paid' : `fine GH₵${Number(l.fine_amount).toFixed(2)}`}</Pill>}
              {isOverdue(l) && <Pill variant="danger">overdue</Pill>}
              <Pill variant={l.status === 'returned' ? 'neutral' : 'success'}>{l.status.replace('_', ' ')}</Pill>
              {l.status === 'on_loan' && !isOverdue(l) && (
                <Button type="button" variant="secondary" onClick={() => act(l.id, 'renew')} disabled={busy}>
                  Renew
                </Button>
              )}
              {l.status === 'on_loan' && (
                <Button type="button" onClick={() => act(l.id, 'return')} disabled={busy}>
                  Return
                </Button>
              )}
              {Number(l.fine_amount) > 0 && !l.fine_paid && (
                <Button type="button" variant="secondary" onClick={() => act(l.id, 'pay-fine')} disabled={busy}>
                  Pay fine
                </Button>
              )}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
