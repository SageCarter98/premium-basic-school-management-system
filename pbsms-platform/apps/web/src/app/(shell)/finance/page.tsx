'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { RestrictedState } from '@/components/states/RestrictedState';
import { apiFetch, apiGet } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { LEADERSHIP, hasAnyRole } from '@/lib/role-groups';
import styles from './finance.module.css';

// Finance keeps its own narrower [accountant + LEADERSHIP] tier, mirrored
// from finance.controller.ts's own inline RECORD_ROLES/READ_ROLES (and
// already anticipated by nav-config.ts's own FINANCE_TEAM constant) rather
// than a shared role-groups.ts group — same reasoning as that file's
// comment. APPROVE_ROLES on the backend is LEADERSHIP only (no accountant)
// for cancel/reverse/approve actions.
const FINANCE_TEAM = [...LEADERSHIP, 'accountant'] as const;

function money(n: number): string {
  return `GH₵${n.toFixed(2)}`;
}

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
interface AcademicYear {
  id: string;
  name: string;
}
interface Enrolment {
  student_id: string;
  class_id: string;
  academic_year_id: string;
  status: string;
}

interface FeeStructure {
  id: string;
  academic_year_id: string;
  level: string;
  name: string;
  status: string;
}
interface FeeStructureItem {
  id: string;
  fee_structure_id: string;
  name: string;
  amount: string;
}
interface FeeInstalment {
  id: string;
  fee_structure_id: string;
  sequence: number;
  amount: string;
  due_date: string;
}
interface Invoice {
  id: string;
  student_id: string;
  fee_structure_id: string;
  invoice_number: string;
  status: string;
  proration_factor: string;
  total_amount: string;
  due_date: string | null;
  issued_at: string;
}
interface InvoiceItem {
  id: string;
  description: string;
  amount: string;
}
interface PenaltyRule {
  id: string;
  fee_structure_id: string;
  name: string;
  grace_period_days: number;
  amount_type: string;
  amount: string;
  cap_amount: string | null;
  frequency: string;
  status: string;
}
interface PenaltyCharge {
  id: string;
  invoice_id: string;
  penalty_rule_id: string;
  amount: string;
  applied_at: string;
  reason: string | null;
  reversed: boolean;
}
interface InvoiceBalance {
  invoiceId: string;
  totalAmount: number;
  allocated: number;
  assisted: number;
  balance: number;
  cancelled: boolean;
}
interface Payment {
  id: string;
  student_id: string;
  method: string;
  provider_reference: string | null;
  status: string;
  amount: string;
  currency: string;
  received_at: string;
}
interface PaymentAllocation {
  id: string;
  payment_id: string;
  invoice_id: string;
  amount: string;
}
interface FinancialAssistance {
  id: string;
  student_id: string;
  invoice_id: string;
  type: string;
  amount: string;
  reason: string;
  requires_second_approval: boolean;
  status: string;
  first_approved_by: string | null;
  rejection_reason: string | null;
}
interface Reversal {
  id: string;
  reversed_entity_type: string;
  reversed_entity_id: string;
  amount: string;
  reason: string;
  created_at: string;
}
interface OutstandingBalance {
  invoice_id: string;
  invoice_number: string;
  student_id: string;
  total_amount: string;
  balance: number;
  due_date: string | null;
  overdue: boolean;
}
interface SettlementBatch {
  id: string;
  source: string;
  reference: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string;
  notes: string | null;
}
interface SettlementLine {
  id: string;
  settlement_batch_id: string;
  line_reference: string | null;
  amount: string;
  value_date: string | null;
  description: string | null;
  matched_payment_id: string | null;
  match_status: string;
}
interface GeneratedDocument {
  id: string;
  document_type: string;
  reference_number: string;
  payment_id: string | null;
  content: {
    student?: { first_name: string; last_name: string; admission_no: string };
    method?: string;
    providerReference?: string | null;
    amount?: string;
    currency?: string;
    receivedAt?: string;
    allocations?: { invoice_id: string; amount: string; invoice_number: string }[];
  };
  generated_at: string;
  revoked_at: string | null;
}

function studentName(students: Student[], id: string): string {
  const s = students.find((st) => st.id === id);
  return s ? `${s.last_name}, ${s.first_name}` : id.slice(0, 8) + '…';
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = body?.message;
  return (Array.isArray(m) ? m.join('; ') : m) ?? fallback;
}

const TABS = ['Fee Structures', 'Invoices', 'Payments', 'Assistance', 'Reversals', 'Dashboard', 'Receipts', 'Reconciliation'] as const;
type Tab = (typeof TABS)[number];

/**
 * SRS Chapters 23-25 (spec §7.10's Finance console + §8.5 Payment
 * Allocation + §8.8 Reconciliation Workspace). Built on the already-real
 * backend Finance module (Chapters 23-25) — no new backend surface for
 * most tabs, matching Stage 5/6's screens-on-existing-primitives pattern.
 *
 * Reconciliation (§8.8) is the one exception — 0034_settlement_
 * reconciliation.sql adds real schema for it. Live provider webhook
 * integration (Paystack/Hubtel/MTN MoMo/Telecel) is still out of scope
 * (mobile_money/card payments are still rejected as not-implemented) —
 * what's built instead is manual/import-based settlement matching against
 * this codebase's own `payments` table, the same posture `payments`
 * itself already has (manual-entry-only). See finance.service.ts's
 * Settlement Reconciliation section header for the full reasoning.
 */
export default function FinancePage() {
  const [tab, setTab] = useState<Tab>('Fee Structures');
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canAccess = hasAnyRole(roleCodes, FINANCE_TEAM);
  const canApprove = hasAnyRole(roleCodes, LEADERSHIP);

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    Promise.all([
      apiGet<Student[]>('/v1/students'),
      apiGet<SchoolClass[]>('/v1/classes'),
      apiGet<AcademicYear[]>('/v1/academic-years'),
      apiGet<Enrolment[]>('/v1/enrolments'),
    ]).then(([s, c, y, e]) => {
      setStudents(s);
      setClasses(c);
      setYears(y);
      setEnrolments(e);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!canAccess) {
    return (
      <Card>
        <RestrictedState message="Finance is available to the Accountant/Bursar and school leadership roles only." />
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading finance" rows={4} />
      </Card>
    );
  }

  const shared = { students, classes, years, enrolments, canApprove };

  return (
    <div>
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
        {tab === 'Fee Structures' && <FeeStructuresTab years={years} />}
        {tab === 'Invoices' && <InvoicesTab {...shared} />}
        {tab === 'Payments' && <PaymentsTab {...shared} />}
        {tab === 'Assistance' && <AssistanceTab {...shared} />}
        {tab === 'Reversals' && <ReversalsTab students={students} />}
        {tab === 'Dashboard' && <DashboardTab students={students} />}
        {tab === 'Receipts' && <ReceiptsTab />}
        {tab === 'Reconciliation' && <ReconciliationTab canApprove={canApprove} />}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------
// Fee Structures
// ---------------------------------------------------------------------

function FeeStructuresTab({ years }: { years: AcademicYear[] }) {
  const [loading, setLoading] = useState(true);
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ academicYearId: '', level: '', name: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<FeeStructure[]>('/v1/finance/fee-structures')
      .then((s) => {
        setStructures(s);
        setForm((f) => ({ ...f, academicYearId: f.academicYearId || years[0]?.id || '' }));
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/finance/fee-structures', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm((f) => ({ ...f, level: '', name: '' }));
      setShowCreate(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create fee structure.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading fee structures" rows={3} />;

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showCreate ? 'Cancel' : 'Add fee structure'}
      </Button>
      {showCreate && (
        <div className={styles.formRow}>
          <select className={styles.select} value={form.academicYearId} onChange={(e) => setForm({ ...form, academicYearId: e.target.value })}>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
          <input className={styles.textInput} placeholder="Level, e.g. JHS 2" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} />
          <input className={styles.textInput} placeholder="Name, e.g. JHS 2 Fees 2026/2027" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Button type="button" onClick={handleCreate} disabled={saving || !form.level || !form.name || !form.academicYearId}>
            Save
          </Button>
        </div>
      )}
      {saveError && <ErrorState message={saveError} />}
      {structures.length === 0 ? (
        <EmptyState title="No fee structures yet" message="Add one, then define items and instalments before activating it." />
      ) : (
        structures.map((s) => (
          <div key={s.id}>
            <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
              <span>
                {s.name} — {s.level} · {years.find((y) => y.id === s.academic_year_id)?.name ?? s.academic_year_id}
              </span>
              <Pill variant={s.status === 'active' ? 'success' : 'neutral'}>{s.status}</Pill>
            </div>
            {expandedId === s.id && <FeeStructureDetail structure={s} onChanged={reload} />}
          </div>
        ))
      )}
    </div>
  );
}

function FeeStructureDetail({ structure, onChanged }: { structure: FeeStructure; onChanged: () => void }) {
  const [items, setItems] = useState<FeeStructureItem[]>([]);
  const [instalments, setInstalments] = useState<FeeInstalment[]>([]);
  const [penaltyRules, setPenaltyRules] = useState<PenaltyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemForm, setItemForm] = useState({ name: '', amount: '' });
  const [instForm, setInstForm] = useState({ sequence: '1', amount: '', percentage: '', dueDate: '' });
  const [ruleForm, setRuleForm] = useState({ name: '', amountType: 'fixed', amount: '', capAmount: '', frequency: 'one_time', gracePeriodDays: '0' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    setLoading(true);
    Promise.all([
      apiGet<FeeStructureItem[]>(`/v1/finance/fee-structures/${structure.id}/items`),
      apiGet<FeeInstalment[]>(`/v1/finance/fee-structures/${structure.id}/instalments`),
      apiGet<PenaltyRule[]>(`/v1/finance/fee-structures/${structure.id}/penalty-rules`),
    ]).then(([i, ins, pr]) => {
      setItems(i);
      setInstalments(ins);
      setPenaltyRules(pr);
      setLoading(false);
    });
  }
  useEffect(reload, [structure.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addPenaltyRule() {
    setError(null);
    setBusy(true);
    const res = await apiFetch(`/v1/finance/fee-structures/${structure.id}/penalty-rules`, {
      method: 'POST',
      body: JSON.stringify({
        name: ruleForm.name,
        amountType: ruleForm.amountType,
        amount: Number(ruleForm.amount),
        capAmount: ruleForm.capAmount ? Number(ruleForm.capAmount) : undefined,
        frequency: ruleForm.frequency,
        gracePeriodDays: Number(ruleForm.gracePeriodDays) || 0,
      }),
    });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setRuleForm({ name: '', amountType: 'fixed', amount: '', capAmount: '', frequency: 'one_time', gracePeriodDays: '0' });
    reload();
  }

  const itemsTotal = items.reduce((sum, i) => sum + Number(i.amount), 0);
  const instalmentsTotal = instalments.reduce((sum, i) => sum + Number(i.amount), 0);
  const sumsMatch = Math.abs(itemsTotal - instalmentsTotal) < 0.01;
  const isDraft = structure.status === 'draft';
  const canActivate = isDraft && items.length > 0 && instalments.length > 0 && sumsMatch;

  async function addItem() {
    setError(null);
    setBusy(true);
    const res = await apiFetch(`/v1/finance/fee-structures/${structure.id}/items`, {
      method: 'POST',
      body: JSON.stringify({ name: itemForm.name, amount: Number(itemForm.amount) }),
    });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setItemForm({ name: '', amount: '' });
    reload();
  }

  async function addInstalment() {
    setError(null);
    setBusy(true);
    const body: Record<string, unknown> = { sequence: Number(instForm.sequence), dueDate: instForm.dueDate };
    if (instForm.percentage) body.percentage = Number(instForm.percentage);
    else body.amount = Number(instForm.amount);
    const res = await apiFetch(`/v1/finance/fee-structures/${structure.id}/instalments`, { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setInstForm({ sequence: String(Number(instForm.sequence) + 1), amount: '', percentage: '', dueDate: '' });
    reload();
  }

  async function activate() {
    setError(null);
    setBusy(true);
    const res = await apiFetch(`/v1/finance/fee-structures/${structure.id}/activate`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    onChanged();
  }

  if (loading) return <LoadingState label="Loading fee structure detail" rows={3} />;

  return (
    <div className={styles.detailPanel}>
      {error && <ErrorState message={error} />}

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Items ({money(itemsTotal)})</div>
        {items.length === 0 ? (
          <p className={styles.hint}>No items yet.</p>
        ) : (
          items.map((i) => (
            <div key={i.id} className={styles.listRow}>
              <span>{i.name}</span>
              <span>{money(Number(i.amount))}</span>
            </div>
          ))
        )}
        {isDraft && (
          <div className={styles.formRow}>
            <input className={styles.textInput} placeholder="Item name, e.g. Tuition" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} />
            <input className={styles.textInput} type="number" min="0.01" step="0.01" placeholder="Amount" value={itemForm.amount} onChange={(e) => setItemForm({ ...itemForm, amount: e.target.value })} />
            <Button type="button" variant="secondary" onClick={addItem} disabled={busy || !itemForm.name || !itemForm.amount}>
              Add item
            </Button>
          </div>
        )}
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Instalments ({money(instalmentsTotal)})</div>
        {instalments.length === 0 ? (
          <p className={styles.hint}>No instalments yet.</p>
        ) : (
          instalments
            .slice()
            .sort((a, b) => a.sequence - b.sequence)
            .map((i) => (
              <div key={i.id} className={styles.listRow}>
                <span>#{i.sequence} — due {i.due_date}</span>
                <span>{money(Number(i.amount))}</span>
              </div>
            ))
        )}
        {isDraft && (
          <div className={styles.formRow}>
            <input className={styles.textInput} type="number" min="1" style={{ maxWidth: 80 }} placeholder="Seq" value={instForm.sequence} onChange={(e) => setInstForm({ ...instForm, sequence: e.target.value })} />
            <input
              className={styles.textInput}
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Amount"
              value={instForm.amount}
              onChange={(e) => setInstForm({ ...instForm, amount: e.target.value, percentage: '' })}
            />
            <input
              className={styles.textInput}
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              placeholder="…or % of items"
              value={instForm.percentage}
              onChange={(e) => setInstForm({ ...instForm, percentage: e.target.value, amount: '' })}
            />
            <input className={styles.textInput} type="date" value={instForm.dueDate} onChange={(e) => setInstForm({ ...instForm, dueDate: e.target.value })} />
            <Button type="button" variant="secondary" onClick={addInstalment} disabled={busy || (!instForm.amount && !instForm.percentage) || !instForm.dueDate}>
              Add instalment
            </Button>
          </div>
        )}
      </div>

      {isDraft && (
        <div className={styles.detailSection}>
          <div className={styles.checklistItem}>
            <span className={items.length > 0 ? styles.checkOk : styles.checkFail}>{items.length > 0 ? '✓' : '✕'}</span>
            <span>Has items</span>
          </div>
          <div className={styles.checklistItem}>
            <span className={instalments.length > 0 ? styles.checkOk : styles.checkFail}>{instalments.length > 0 ? '✓' : '✕'}</span>
            <span>Has instalments</span>
          </div>
          <div className={styles.checklistItem}>
            <span className={sumsMatch ? styles.checkOk : styles.checkFail}>{sumsMatch ? '✓' : '✕'}</span>
            <span>Instalments sum to the items total (FR-FEE-020)</span>
          </div>
          <Button type="button" onClick={activate} disabled={busy || !canActivate} style={{ marginTop: 'var(--pb-space-2)' }}>
            Activate
          </Button>
        </div>
      )}

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Penalty rules (FR-FEE-040)</div>
        {penaltyRules.length === 0 ? (
          <p className={styles.hint}>No penalty rules yet. Rules apply to invoices generated from this fee structure, past their grace period.</p>
        ) : (
          penaltyRules.map((r) => (
            <div key={r.id} className={styles.listRow}>
              <span>
                {r.name} — {r.amount_type === 'percentage' ? `${r.amount}%` : money(Number(r.amount))}
                {r.cap_amount && ` (capped at ${money(Number(r.cap_amount))})`} · {r.frequency.replace('_', ' ')} · {r.grace_period_days}-day grace
              </span>
              <Pill variant={r.status === 'active' ? 'success' : 'neutral'}>{r.status}</Pill>
            </div>
          ))
        )}
        <div className={styles.formRow}>
          <input aria-label="Rule name" className={styles.textInput} placeholder="Rule name, e.g. Late tuition fee" value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} />
          <select aria-label="Amount type" className={styles.select} value={ruleForm.amountType} onChange={(e) => setRuleForm({ ...ruleForm, amountType: e.target.value })}>
            <option value="fixed">Fixed amount</option>
            <option value="percentage">Percentage of balance</option>
          </select>
          <input
            aria-label={ruleForm.amountType === 'percentage' ? 'Percentage' : 'Amount'}
            className={styles.textInput}
            type="number"
            min="0.01"
            step="0.01"
            placeholder={ruleForm.amountType === 'percentage' ? 'Percentage' : 'Amount'}
            value={ruleForm.amount}
            onChange={(e) => setRuleForm({ ...ruleForm, amount: e.target.value })}
          />
          <input
            aria-label="Cap amount"
            className={styles.textInput}
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Cap amount (optional)"
            value={ruleForm.capAmount}
            onChange={(e) => setRuleForm({ ...ruleForm, capAmount: e.target.value })}
          />
          <select aria-label="Frequency" className={styles.select} value={ruleForm.frequency} onChange={(e) => setRuleForm({ ...ruleForm, frequency: e.target.value })}>
            <option value="one_time">One time</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <input
            aria-label="Grace period days"
            className={styles.textInput}
            type="number"
            min="0"
            style={{ maxWidth: 130 }}
            placeholder="Grace days"
            value={ruleForm.gracePeriodDays}
            onChange={(e) => setRuleForm({ ...ruleForm, gracePeriodDays: e.target.value })}
          />
          <Button type="button" variant="secondary" onClick={addPenaltyRule} disabled={busy || !ruleForm.name || !ruleForm.amount}>
            Add rule
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------

interface SharedProps {
  students: Student[];
  classes: SchoolClass[];
  years: AcademicYear[];
  enrolments: Enrolment[];
  canApprove: boolean;
}

function InvoicesTab({ students, classes, years, enrolments, canApprove }: SharedProps) {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [showGenerate, setShowGenerate] = useState(false);
  const [mode, setMode] = useState<'single' | 'class'>('single');
  const [form, setForm] = useState({ feeStructureId: '', studentId: '', classId: '', academicYearId: '', prorationFactor: '1' });
  const [preview, setPreview] = useState<Student[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genResult, setGenResult] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    Promise.all([apiGet<Invoice[]>('/v1/finance/invoices'), apiGet<FeeStructure[]>('/v1/finance/fee-structures')]).then(([i, s]) => {
      setInvoices(i);
      setStructures(s.filter((st) => st.status === 'active'));
      setForm((f) => ({ ...f, feeStructureId: f.feeStructureId || s.find((st) => st.status === 'active')?.id || '', studentId: f.studentId || students[0]?.id || '' }));
      setLoading(false);
    });
  }
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeStructure = structures.find((s) => s.id === form.feeStructureId);

  function buildClassPreview() {
    const targetEnrolments = enrolments.filter((e) => e.class_id === form.classId && e.academic_year_id === form.academicYearId && e.status === 'active');
    const alreadyInvoiced = new Set(invoices.filter((i) => i.fee_structure_id === form.feeStructureId).map((i) => i.student_id));
    const targetStudents = targetEnrolments.map((e) => students.find((s) => s.id === e.student_id)).filter((s): s is Student => !!s && !alreadyInvoiced.has(s.id));
    setPreview(targetStudents);
  }

  async function confirmGenerate() {
    setBusy(true);
    setGenError(null);
    setGenResult(null);
    const targets = mode === 'single' ? [form.studentId] : (preview ?? []).map((s) => s.id);
    let ok = 0;
    let failed = 0;
    for (const studentId of targets) {
      const res = await apiFetch('/v1/finance/invoices', {
        method: 'POST',
        body: JSON.stringify({ studentId, feeStructureId: form.feeStructureId, prorationFactor: Number(form.prorationFactor) || 1 }),
      });
      if (res.ok) ok++;
      else failed++;
    }
    setGenResult(`Generated ${ok} invoice(s)${failed ? `, ${failed} failed` : ''}.`);
    setPreview(null);
    setBusy(false);
    reload();
  }

  if (loading) return <LoadingState label="Loading invoices" rows={4} />;

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowGenerate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showGenerate ? 'Cancel' : 'Generate invoice(s)'}
      </Button>

      {showGenerate && (
        <div style={{ marginBottom: 'var(--pb-space-4)' }}>
          <div className={styles.formRow}>
            <select className={styles.select} value={mode} onChange={(e) => { setMode(e.target.value as 'single' | 'class'); setPreview(null); }}>
              <option value="single">Single student</option>
              <option value="class">Whole class (run)</option>
            </select>
            <select className={styles.select} value={form.feeStructureId} onChange={(e) => setForm({ ...form, feeStructureId: e.target.value })}>
              {structures.length === 0 && <option value="">No active fee structures</option>}
              {structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              className={styles.textInput}
              type="number"
              min="0.01"
              max="1"
              step="0.01"
              style={{ maxWidth: 130 }}
              value={form.prorationFactor}
              onChange={(e) => setForm({ ...form, prorationFactor: e.target.value })}
              title="Proration factor (1 = full charge)"
            />
          </div>

          {mode === 'single' ? (
            <div className={styles.formRow}>
              <select className={styles.select} value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.last_name}, {s.first_name}
                  </option>
                ))}
              </select>
              <Button type="button" onClick={confirmGenerate} disabled={busy || !form.feeStructureId || !form.studentId}>
                Generate
              </Button>
            </div>
          ) : (
            <>
              <div className={styles.formRow}>
                <select
                  className={styles.select}
                  value={form.classId}
                  onChange={(e) => {
                    const c = classes.find((cl) => cl.id === e.target.value);
                    setForm({ ...form, classId: e.target.value, academicYearId: c?.academic_year_id ?? form.academicYearId });
                    setPreview(null);
                  }}
                >
                  <option value="">Choose a class</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select className={styles.select} value={form.academicYearId} onChange={(e) => { setForm({ ...form, academicYearId: e.target.value }); setPreview(null); }}>
                  <option value="">Choose an academic year</option>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="secondary" onClick={buildClassPreview} disabled={!form.classId || !form.academicYearId || !form.feeStructureId}>
                  Preview
                </Button>
              </div>
              {preview && (
                <div className={styles.detailPanel} style={{ marginBottom: 'var(--pb-space-3)' }}>
                  {preview.length === 0 ? (
                    <EmptyState title="Nothing to generate" message="Every enrolled student already has an invoice from this fee structure, or the class has no active enrolments." />
                  ) : (
                    <>
                      <p className={styles.hint}>This will generate {preview.length} invoice(s) — students not yet invoiced from this fee structure:</p>
                      {preview.map((s) => (
                        <div key={s.id} className={styles.listRow}>
                          <span>
                            {s.last_name}, {s.first_name}
                          </span>
                        </div>
                      ))}
                      <Button type="button" onClick={confirmGenerate} disabled={busy} style={{ marginTop: 'var(--pb-space-3)' }}>
                        Confirm — generate {preview.length} invoice(s)
                      </Button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {activeStructure === undefined && form.feeStructureId === '' && (
            <p className={styles.hint}>Activate a fee structure first (Fee Structures tab) before generating invoices from it.</p>
          )}
          {genError && <ErrorState message={genError} />}
          {genResult && <p className={styles.hint}>{genResult}</p>}
        </div>
      )}

      {invoices.length === 0 ? (
        <EmptyState title="No invoices yet" message="Generate one from an active fee structure." />
      ) : (
        invoices.map((inv) => (
          <div key={inv.id}>
            <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}>
              <span>
                {inv.invoice_number} — {studentName(students, inv.student_id)}
                {inv.due_date && <> · due {inv.due_date}</>}
              </span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                <span>{money(Number(inv.total_amount))}</span>
                <Pill variant={inv.status === 'posted' ? 'success' : 'neutral'}>{inv.status}</Pill>
              </span>
            </div>
            {expandedId === inv.id && <InvoiceDetail invoice={inv} students={students} canApprove={canApprove} onChanged={reload} />}
          </div>
        ))
      )}
    </div>
  );
}

function InvoiceDetail({ invoice, students, canApprove, onChanged }: { invoice: Invoice; students: Student[]; canApprove: boolean; onChanged: () => void }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [balance, setBalance] = useState<InvoiceBalance | null>(null);
  const [penaltyRules, setPenaltyRules] = useState<PenaltyRule[]>([]);
  const [penaltyCharges, setPenaltyCharges] = useState<PenaltyCharge[]>([]);
  const [applyRuleId, setApplyRuleId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    setLoading(true);
    Promise.all([
      apiGet<InvoiceItem[]>(`/v1/finance/invoices/${invoice.id}/items`),
      apiGet<InvoiceBalance>(`/v1/finance/invoices/${invoice.id}/balance`),
      apiGet<PenaltyRule[]>(`/v1/finance/fee-structures/${invoice.fee_structure_id}/penalty-rules`),
      apiGet<PenaltyCharge[]>(`/v1/finance/invoices/${invoice.id}/penalties`),
    ]).then(([i, b, pr, pc]) => {
      setItems(i);
      setBalance(b);
      setPenaltyRules(pr);
      setPenaltyCharges(pc);
      setLoading(false);
    });
  }
  useEffect(reload, [invoice.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cancel() {
    const reason = window.prompt('Reason for cancelling this invoice (required):');
    if (!reason) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/finance/invoices/${invoice.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    onChanged();
  }

  async function applyPenalty() {
    if (!applyRuleId) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/finance/invoices/${invoice.id}/penalties/apply`, { method: 'POST', body: JSON.stringify({ penaltyRuleId: applyRuleId }) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setApplyRuleId('');
    reload();
  }

  async function reversePenalty(chargeId: string) {
    const reason = window.prompt('Reason for reversing this penalty charge (required):');
    if (!reason) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/finance/penalties/${chargeId}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
  }

  if (loading) return <LoadingState label="Loading invoice detail" rows={3} />;

  return (
    <div className={styles.detailPanel}>
      {error && <ErrorState message={error} />}
      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Line items</div>
        {items.map((i) => (
          <div key={i.id} className={styles.listRow}>
            <span>{i.description}</span>
            <span>{money(Number(i.amount))}</span>
          </div>
        ))}
      </div>
      {balance && (
        <div className={styles.detailSection}>
          <div className={styles.checklistItem}>
            <span>Total</span>
            <span style={{ marginLeft: 'auto' }}>{money(balance.totalAmount)}</span>
          </div>
          <div className={styles.checklistItem}>
            <span>Allocated (payments)</span>
            <span style={{ marginLeft: 'auto' }}>{money(balance.allocated)}</span>
          </div>
          <div className={styles.checklistItem}>
            <span>Assisted (scholarships/waivers)</span>
            <span style={{ marginLeft: 'auto' }}>{money(balance.assisted)}</span>
          </div>
          <div className={styles.remainderBar}>
            <span>Balance</span>
            <span className={balance.balance === 0 ? styles.remainderZero : styles.remainderOpen}>{money(balance.balance)}</span>
          </div>
        </div>
      )}
      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Penalties (FR-FEE-040)</div>
        {penaltyCharges.length === 0 ? (
          <p className={styles.hint}>No penalties applied to this invoice.</p>
        ) : (
          penaltyCharges.map((c) => (
            <div key={c.id} className={styles.listRow}>
              <span>
                {penaltyRules.find((r) => r.id === c.penalty_rule_id)?.name ?? c.penalty_rule_id} — applied {new Date(c.applied_at).toLocaleDateString()}
              </span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                <span>{money(Number(c.amount))}</span>
                {c.reversed ? (
                  <Pill variant="danger">reversed</Pill>
                ) : (
                  canApprove && (
                    <Button type="button" variant="secondary" onClick={() => reversePenalty(c.id)} disabled={busy}>
                      Reverse
                    </Button>
                  )
                )}
              </span>
            </div>
          ))
        )}
        {invoice.status === 'posted' && penaltyRules.length > 0 && (
          <div className={styles.formRow}>
            <select aria-label="Penalty rule to apply" className={styles.select} value={applyRuleId} onChange={(e) => setApplyRuleId(e.target.value)}>
              <option value="">Penalty rule…</option>
              {penaltyRules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <Button type="button" variant="secondary" onClick={applyPenalty} disabled={busy || !applyRuleId}>
              Apply penalty
            </Button>
          </div>
        )}
      </div>

      {canApprove && invoice.status === 'posted' && (
        <Button type="button" variant="secondary" onClick={cancel} disabled={busy}>
          Cancel invoice
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Payments (§8.5 Payment Allocation lives in the expanded detail)
// ---------------------------------------------------------------------

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'mobile_money', label: 'Mobile money (not available yet)' },
  { value: 'card', label: 'Card (not available yet)' },
];

function PaymentsTab({ students, canApprove }: SharedProps) {
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [reversals, setReversals] = useState<Reversal[]>([]);
  const [showRecord, setShowRecord] = useState(false);
  const [form, setForm] = useState({ studentId: '', method: 'cash', amount: '', currency: 'GHS', providerReference: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    Promise.all([apiGet<Payment[]>('/v1/finance/payments'), apiGet<Reversal[]>('/v1/finance/reversals')]).then(([p, r]) => {
      setPayments(p);
      setReversals(r);
      setForm((f) => ({ ...f, studentId: f.studentId || students[0]?.id || '' }));
      setLoading(false);
    });
  }
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRecord() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/finance/payments', {
        method: 'POST',
        body: JSON.stringify({ ...form, amount: Number(form.amount), providerReference: form.providerReference || undefined }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm((f) => ({ ...f, amount: '', providerReference: '' }));
      setShowRecord(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not record payment.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading payments" rows={4} />;

  const isReversed = (id: string) => reversals.some((r) => r.reversed_entity_type === 'payment' && r.reversed_entity_id === id);

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowRecord((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showRecord ? 'Cancel' : 'Record payment'}
      </Button>
      {showRecord && (
        <div className={styles.formRow}>
          <select className={styles.select} value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.last_name}, {s.first_name}
              </option>
            ))}
          </select>
          <select className={styles.select} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <input className={styles.textInput} type="number" min="0.01" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <input className={styles.textInput} placeholder="Reference (optional)" value={form.providerReference} onChange={(e) => setForm({ ...form, providerReference: e.target.value })} />
          <Button type="button" onClick={handleRecord} disabled={saving || !form.studentId || !form.amount}>
            Save
          </Button>
        </div>
      )}
      {saveError && <ErrorState message={saveError} />}
      {payments.length === 0 ? (
        <EmptyState title="No payments yet" message="Record one against a student, then allocate it to an invoice." />
      ) : (
        payments.map((p) => (
          <div key={p.id}>
            <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
              <span>
                {studentName(students, p.student_id)} — {p.method} · {new Date(p.received_at).toLocaleDateString()}
              </span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                <span>{money(Number(p.amount))}</span>
                {isReversed(p.id) ? <Pill variant="danger">reversed</Pill> : <Pill variant="success">{p.status}</Pill>}
              </span>
            </div>
            {expandedId === p.id && <PaymentDetail payment={p} students={students} canApprove={canApprove} reversed={isReversed(p.id)} onChanged={reload} />}
          </div>
        ))
      )}
    </div>
  );
}

function PaymentDetail({
  payment,
  students,
  canApprove,
  reversed,
  onChanged,
}: {
  payment: Payment;
  students: Student[];
  canApprove: boolean;
  reversed: boolean;
  onChanged: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);
  const [candidateInvoices, setCandidateInvoices] = useState<(Invoice & { balance: number })[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiptMsg, setReceiptMsg] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    Promise.all([apiGet<PaymentAllocation[]>(`/v1/finance/payments/${payment.id}/allocations`), apiGet<Invoice[]>('/v1/finance/invoices')]).then(async ([allocs, allInvoices]) => {
      setAllocations(allocs);
      const studentInvoices = allInvoices.filter((i) => i.student_id === payment.student_id && i.status === 'posted');
      const withBalance = await Promise.all(
        studentInvoices.map(async (i) => ({ ...i, balance: (await apiGet<InvoiceBalance>(`/v1/finance/invoices/${i.id}/balance`)).balance })),
      );
      setCandidateInvoices(withBalance.filter((i) => i.balance > 0));
      setLoading(false);
    });
  }
  useEffect(reload, [payment.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const allocatedSoFar = allocations.reduce((sum, a) => sum + Number(a.amount), 0);
  const remaining = Number(payment.amount) - allocatedSoFar;

  async function allocate(invoiceId: string) {
    const amt = Number(amounts[invoiceId]);
    if (!amt || amt <= 0) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/finance/payments/${payment.id}/allocate`, { method: 'POST', body: JSON.stringify({ invoiceId, amount: amt }) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setAmounts((a) => ({ ...a, [invoiceId]: '' }));
    reload();
  }

  async function reverse() {
    const reason = window.prompt('Reason for reversing this payment (required):');
    if (!reason) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/finance/payments/${payment.id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    onChanged();
  }

  async function generateReceipt() {
    setBusy(true);
    setError(null);
    setReceiptMsg(null);
    const res = await apiFetch('/v1/documents/receipts', { method: 'POST', body: JSON.stringify({ paymentId: payment.id }) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    const doc = (await res.json()) as { reference_number: string };
    setReceiptMsg(`Receipt ${doc.reference_number} generated — view or reprint it from the Receipts tab.`);
  }

  if (loading) return <LoadingState label="Loading payment detail" rows={3} />;

  return (
    <div className={styles.detailPanel}>
      {error && <ErrorState message={error} />}
      {receiptMsg && <p className={styles.hint}>{receiptMsg}</p>}

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Payment Allocation</div>
        <p className={styles.hint}>Chapter 24.1&apos;s model: payments are independent of invoices, joined only by allocations.</p>
        {allocations.length > 0 && (
          <>
            {allocations.map((a) => {
              const inv = candidateInvoices.find((i) => i.id === a.invoice_id);
              return (
                <div key={a.id} className={styles.listRow}>
                  <span>{inv?.invoice_number ?? a.invoice_id}</span>
                  <span>{money(Number(a.amount))}</span>
                </div>
              );
            })}
          </>
        )}
        <div className={styles.remainderBar}>
          <span>Unallocated remainder</span>
          <span className={remaining === 0 ? styles.remainderZero : styles.remainderOpen}>{money(remaining)}</span>
        </div>
        {remaining > 0 && !reversed && (
          <>
            {candidateInvoices.length === 0 ? (
              <EmptyState title="No outstanding invoices" message={`${studentName(students, payment.student_id)} has no posted invoice with a balance to allocate against.`} />
            ) : (
              candidateInvoices.map((inv) => (
                <div key={inv.id} className={styles.allocRow}>
                  <span>
                    {inv.invoice_number} — balance {money(inv.balance)}
                  </span>
                  <span style={{ display: 'flex', gap: 'var(--pb-space-2)' }}>
                    <input
                      className={styles.allocInput}
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Amount"
                      value={amounts[inv.id] ?? ''}
                      onChange={(e) => setAmounts((a) => ({ ...a, [inv.id]: e.target.value }))}
                    />
                    <Button type="button" variant="secondary" onClick={() => allocate(inv.id)} disabled={busy}>
                      Allocate
                    </Button>
                  </span>
                </div>
              ))
            )}
          </>
        )}
        {remaining === 0 && <p className={styles.hint}>Fully allocated, or deliberately left as credit if this reads 0 with invoices still outstanding.</p>}
      </div>

      <div className={styles.actionRow}>
        <Button type="button" variant="secondary" onClick={generateReceipt} disabled={busy}>
          Generate receipt
        </Button>
        {canApprove && !reversed && (
          <Button type="button" variant="secondary" onClick={reverse} disabled={busy}>
            Reverse payment
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Financial Assistance
// ---------------------------------------------------------------------

const ASSISTANCE_TYPES = ['scholarship', 'discount', 'waiver', 'sponsor_credit'];

const ASSISTANCE_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pending: 'warning',
  first_approved: 'warning',
  approved: 'success',
  rejected: 'danger',
};

function AssistanceTab({ students, canApprove }: SharedProps) {
  const [loading, setLoading] = useState(true);
  const [assistance, setAssistance] = useState<FinancialAssistance[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [reversals, setReversals] = useState<Reversal[]>([]);
  const [showRequest, setShowRequest] = useState(false);
  const [form, setForm] = useState({ studentId: '', invoiceId: '', type: ASSISTANCE_TYPES[0], amount: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    Promise.all([apiGet<FinancialAssistance[]>('/v1/finance/assistance'), apiGet<Invoice[]>('/v1/finance/invoices'), apiGet<Reversal[]>('/v1/finance/reversals')]).then(([a, i, r]) => {
      setAssistance(a);
      setInvoices(i);
      setReversals(r);
      setForm((f) => ({ ...f, studentId: f.studentId || students[0]?.id || '' }));
      setLoading(false);
    });
  }
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  const studentInvoices = invoices.filter((i) => i.student_id === form.studentId && i.status === 'posted');

  async function handleRequest() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/finance/assistance', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount) }) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm((f) => ({ ...f, amount: '', reason: '' }));
      setShowRequest(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not request assistance.');
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, action: 'approve' | 'second-approve' | 'reject' | 'reverse', body?: { reason: string }) {
    setActError(null);
    const res = await apiFetch(`/v1/finance/assistance/${id}/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) return setActError(await errorMessage(res, `Failed (${res.status})`));
    reload();
  }

  if (loading) return <LoadingState label="Loading financial assistance" rows={4} />;

  const isReversed = (id: string) => reversals.some((r) => r.reversed_entity_type === 'financial_assistance' && r.reversed_entity_id === id);

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowRequest((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showRequest ? 'Cancel' : 'Request assistance'}
      </Button>
      {showRequest && (
        <div style={{ marginBottom: 'var(--pb-space-3)' }}>
          <div className={styles.formRow}>
            <select className={styles.select} value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value, invoiceId: '' })}>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.last_name}, {s.first_name}
                </option>
              ))}
            </select>
            <select className={styles.select} value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: e.target.value })}>
              <option value="">Choose an invoice</option>
              {studentInvoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoice_number} — {money(Number(i.total_amount))}
                </option>
              ))}
            </select>
            <select className={styles.select} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {ASSISTANCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.formRow}>
            <input className={styles.textInput} type="number" min="0.01" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <input className={styles.textInput} placeholder="Reason (required)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            <Button type="button" onClick={handleRequest} disabled={saving || !form.invoiceId || !form.amount || !form.reason}>
              Submit request
            </Button>
          </div>
          <p className={styles.hint}>Requests above GH₵500.00 require a second approver who is not the first (FR-FIN-010).</p>
        </div>
      )}
      {saveError && <ErrorState message={saveError} />}
      {actError && <ErrorState message={actError} />}
      {assistance.length === 0 ? (
        <EmptyState title="No assistance requests yet" message="Request a scholarship, discount, waiver or sponsor credit against a posted invoice." />
      ) : (
        assistance.map((a) => (
          <div key={a.id} className={styles.listRow}>
            <span>
              {studentName(students, a.student_id)} — {invoices.find((i) => i.id === a.invoice_id)?.invoice_number ?? a.invoice_id} · {a.type.replace('_', ' ')} · {money(Number(a.amount))}
              {a.status === 'rejected' && a.rejection_reason && <> — {a.rejection_reason}</>}
            </span>
            <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
              {isReversed(a.id) ? <Pill variant="danger">reversed</Pill> : <Pill variant={ASSISTANCE_STATUS_VARIANT[a.status] ?? 'neutral'}>{a.status.replace('_', ' ')}</Pill>}
              {canApprove && a.status === 'pending' && (
                <>
                  <Button type="button" onClick={() => act(a.id, 'approve')}>
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const reason = window.prompt('Reason for rejecting this request:');
                      if (reason) act(a.id, 'reject', { reason });
                    }}
                  >
                    Reject
                  </Button>
                </>
              )}
              {canApprove && a.status === 'first_approved' && (
                <>
                  <Button type="button" onClick={() => act(a.id, 'second-approve')}>
                    Second-approve
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const reason = window.prompt('Reason for rejecting this request:');
                      if (reason) act(a.id, 'reject', { reason });
                    }}
                  >
                    Reject
                  </Button>
                </>
              )}
              {canApprove && a.status === 'approved' && !isReversed(a.id) && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    const reason = window.prompt('Reason for reversing this assistance (required):');
                    if (reason) act(a.id, 'reverse', { reason });
                  }}
                >
                  Reverse
                </Button>
              )}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Reversals — read-only ledger (the actual reverse actions live on
// Invoices/Payments/Assistance, next to what they act on)
// ---------------------------------------------------------------------

function ReversalsTab({ students }: { students: Student[] }) {
  const [loading, setLoading] = useState(true);
  const [reversals, setReversals] = useState<Reversal[]>([]);

  useEffect(() => {
    apiGet<Reversal[]>('/v1/finance/reversals')
      .then(setReversals)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState label="Loading reversals" rows={3} />;

  return (
    <div>
      <p className={styles.hint}>
        A read-only audit ledger — a reversal is never a delete, it is a linked correcting entry (FR-FIN-020). Reverse a payment or assistance request from its
        own row on the Payments/Assistance tabs; cancel an invoice from the Invoices tab.
      </p>
      {reversals.length === 0 ? (
        <EmptyState title="No reversals yet" message="Reversed payments, assistance and cancelled invoices appear here." />
      ) : (
        reversals.map((r) => (
          <div key={r.id} className={styles.listRow}>
            <span>
              {r.reversed_entity_type.replace('_', ' ')} {r.reversed_entity_id.slice(0, 8)}… — {r.reason}
            </span>
            <span>
              {money(Number(r.amount))} · {new Date(r.created_at).toLocaleDateString()}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Dashboard — outstanding balances (one of FR-FIN-040's eight dashboards;
// see finance.service.ts's own class header for the other seven's status)
// ---------------------------------------------------------------------

function DashboardTab({ students }: { students: Student[] }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<OutstandingBalance[]>([]);

  useEffect(() => {
    apiGet<OutstandingBalance[]>('/v1/finance/dashboard/outstanding-balances')
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState label="Loading the outstanding-balances dashboard" rows={4} />;

  const totalOutstanding = rows.reduce((sum, r) => sum + r.balance, 0);
  const overdueCount = rows.filter((r) => r.overdue).length;

  return (
    <div>
      <div className={styles.formRow}>
        <div className={styles.checklistItem}>
          <strong>{money(totalOutstanding)}</strong>&nbsp;total outstanding across {rows.length} invoice(s), {overdueCount} overdue.
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing outstanding" message="Every posted invoice is either fully paid, fully assisted, or cancelled." />
      ) : (
        rows
          .slice()
          .sort((a, b) => b.balance - a.balance)
          .map((r) => (
            <div key={r.invoice_id} className={styles.listRow}>
              <span>
                {r.invoice_number} — {studentName(students, r.student_id)}
                {r.due_date && <> · due {r.due_date}</>}
              </span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                <span>{money(r.balance)}</span>
                {r.overdue && <Pill variant="danger">overdue</Pill>}
              </span>
            </div>
          ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Receipts — issue-list + reprint. Issuance itself happens from a
// payment's own row on the Payments tab (see PaymentDetail's "Generate
// receipt" button) rather than duplicating a payment picker here.
// ---------------------------------------------------------------------

function ReceiptsTab() {
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // GET /v1/documents has no document_type filter yet (same unfiltered-
    // findAll() gap every prior stage has hit) — filtered client-side.
    apiGet<GeneratedDocument[]>('/v1/documents')
      .then((all) => setDocuments(all.filter((d) => d.document_type === 'receipt')))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load receipts.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState label="Loading receipts" rows={3} />;
  if (error) return <ErrorState message={error} />;

  const receipts = useMemo(() => documents.slice().sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1)), [documents]);

  return (
    <div>
      <p className={styles.hint}>Issue a receipt from the payment it belongs to, on the Payments tab. This is the reprint ledger.</p>
      {receipts.length === 0 ? (
        <EmptyState title="No receipts issued yet" message="Generate one from a payment's detail row on the Payments tab." />
      ) : (
        receipts.map((d) => (
          <div key={d.id}>
            <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>
              <span>
                {d.reference_number} — {d.content.student ? `${d.content.student.last_name}, ${d.content.student.first_name}` : d.payment_id}
              </span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                <span>{d.content.amount ? money(Number(d.content.amount)) : ''}</span>
                {d.revoked_at ? <Pill variant="danger">revoked</Pill> : <Pill variant="success">issued</Pill>}
              </span>
            </div>
            {expandedId === d.id && (
              <div className={styles.detailPanel}>
                <div className={styles.receiptBox}>
                  <p>
                    <strong>{d.reference_number}</strong>
                    <br />
                    {d.content.student && (
                      <>
                        {d.content.student.last_name}, {d.content.student.first_name} ({d.content.student.admission_no})
                        <br />
                      </>
                    )}
                    Method: {d.content.method}
                    {d.content.providerReference && <> · Ref: {d.content.providerReference}</>}
                    <br />
                    Amount: {d.content.amount ? money(Number(d.content.amount)) : '—'} {d.content.currency}
                    <br />
                    Received: {d.content.receivedAt ? new Date(d.content.receivedAt).toLocaleString() : '—'}
                  </p>
                  {d.content.allocations && d.content.allocations.length > 0 && (
                    <>
                      <p style={{ fontWeight: 700, marginTop: 'var(--pb-space-2)' }}>Applied to:</p>
                      {d.content.allocations.map((a) => (
                        <div key={a.invoice_id} className={styles.listRow}>
                          <span>{a.invoice_number}</span>
                          <span>{money(Number(a.amount))}</span>
                        </div>
                      ))}
                    </>
                  )}
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
// Reconciliation — §8.8's manual/import-based settlement matching (see
// this file's own header, and finance.service.ts's Settlement
// Reconciliation section, for why this is not a live provider integration).
// ---------------------------------------------------------------------

function ReconciliationTab({ canApprove }: { canApprove: boolean }) {
  const [loading, setLoading] = useState(true);
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ source: 'bank_statement', reference: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<SettlementBatch[]>('/v1/finance/settlement-batches')
      .then(setBatches)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/v1/finance/settlement-batches', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm({ source: 'bank_statement', reference: '', notes: '' });
      setShowCreate(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create settlement batch.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading settlement batches" rows={3} />;

  return (
    <div>
      <p className={styles.hint}>
        Enter or import an external statement (bank, mobile money, card settlement) as a batch of lines, then match each line against a recorded payment.
        This is manual/import-based reconciliation, not a live provider feed — the same manual-entry posture the Payments tab itself already has.
      </p>
      <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showCreate ? 'Cancel' : 'New settlement batch'}
      </Button>
      {showCreate && (
        <div className={styles.formRow}>
          <select className={styles.select} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
            <option value="bank_statement">Bank statement</option>
            <option value="mobile_money_statement">Mobile money statement</option>
            <option value="card_settlement">Card settlement</option>
            <option value="other">Other</option>
          </select>
          <input className={styles.textInput} placeholder="Reference (e.g. STMT-2026-08)" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          <input className={styles.textInput} placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <Button type="button" onClick={handleCreate} disabled={saving}>
            Save
          </Button>
        </div>
      )}
      {saveError && <ErrorState message={saveError} />}
      {batches.length === 0 ? (
        <EmptyState title="No settlement batches yet" message="Create one for each external statement you want to reconcile against recorded payments." />
      ) : (
        batches.map((b) => (
          <div key={b.id}>
            <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}>
              <span>
                {b.source.replace(/_/g, ' ')} {b.reference && `— ${b.reference}`}
              </span>
              <Pill variant={b.status === 'open' ? 'neutral' : 'success'}>{b.status}</Pill>
            </div>
            {expandedId === b.id && <SettlementBatchDetail batch={b} canApprove={canApprove} onChanged={reload} />}
          </div>
        ))
      )}
    </div>
  );
}

function SettlementBatchDetail({ batch, canApprove, onChanged }: { batch: SettlementBatch; canApprove: boolean; onChanged: () => void }) {
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<SettlementLine[]>([]);
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineForm, setLineForm] = useState({ lineReference: '', amount: '', description: '' });
  const [matchPaymentId, setMatchPaymentId] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchSummary, setMatchSummary] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<SettlementLine[]>(`/v1/finance/settlement-batches/${batch.id}/lines`)
      .then(setLines)
      .finally(() => setLoading(false));
  }
  useEffect(reload, [batch.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addLine() {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/finance/settlement-batches/${batch.id}/lines`, {
      method: 'POST',
      body: JSON.stringify({ ...lineForm, amount: Number(lineForm.amount) }),
    });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setLineForm({ lineReference: '', amount: '', description: '' });
    setShowAddLine(false);
    reload();
  }

  async function autoMatch() {
    setBusy(true);
    setError(null);
    setMatchSummary(null);
    const res = await apiFetch(`/v1/finance/settlement-batches/${batch.id}/auto-match`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    const result = (await res.json()) as { matchedCount: number; remainingUnmatched: number };
    setMatchSummary(`Matched ${result.matchedCount} line(s); ${result.remainingUnmatched} still unmatched.`);
    reload();
  }

  async function manualMatch(lineId: string) {
    const paymentId = matchPaymentId[lineId];
    if (!paymentId) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/finance/settlement-lines/${lineId}/match`, { method: 'POST', body: JSON.stringify({ paymentId }) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
  }

  async function unmatch(lineId: string) {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/finance/settlement-lines/${lineId}/unmatch`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
  }

  async function closeBatch() {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/v1/finance/settlement-batches/${batch.id}/close`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    onChanged();
  }

  const matchVariant: Record<string, 'success' | 'danger' | 'neutral'> = { matched: 'success', discrepancy: 'danger', unmatched: 'neutral' };

  return (
    <div className={styles.detailPanel}>
      {loading ? (
        <LoadingState label="Loading settlement lines" rows={2} />
      ) : (
        <>
          <div className={styles.actionRow}>
            {batch.status === 'open' && (
              <Button type="button" variant="secondary" onClick={() => setShowAddLine((v) => !v)}>
                {showAddLine ? 'Cancel' : 'Add line'}
              </Button>
            )}
            {batch.status === 'open' && (
              <Button type="button" variant="secondary" onClick={autoMatch} disabled={busy}>
                Auto-match
              </Button>
            )}
            {canApprove && batch.status === 'open' && (
              <Button type="button" onClick={closeBatch} disabled={busy}>
                Close batch
              </Button>
            )}
          </div>
          {matchSummary && <p className={styles.hint}>{matchSummary}</p>}
          {error && <ErrorState message={error} />}

          {showAddLine && (
            <div className={styles.formRow}>
              <input className={styles.textInput} placeholder="Reference (e.g. CASH-0001)" value={lineForm.lineReference} onChange={(e) => setLineForm({ ...lineForm, lineReference: e.target.value })} />
              <input className={styles.textInput} type="number" min="0.01" step="0.01" placeholder="Amount" value={lineForm.amount} onChange={(e) => setLineForm({ ...lineForm, amount: e.target.value })} />
              <input className={styles.textInput} placeholder="Description (optional)" value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} />
              <Button type="button" onClick={addLine} disabled={busy || !lineForm.amount}>
                Save
              </Button>
            </div>
          )}

          {lines.length === 0 ? (
            <EmptyState title="No lines yet" message="Add each external transaction line, then auto-match or match them by hand." />
          ) : (
            lines.map((l) => (
              <div key={l.id} className={styles.listRow}>
                <span>
                  {l.line_reference ?? '(no reference)'} — {money(Number(l.amount))}
                  {l.description && <> · {l.description}</>}
                </span>
                <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                  <Pill variant={matchVariant[l.match_status]}>{l.match_status}</Pill>
                  {batch.status === 'open' && l.match_status !== 'matched' && (
                    <>
                      <input
                        className={styles.allocInput}
                        placeholder="Payment id"
                        value={matchPaymentId[l.id] ?? ''}
                        onChange={(e) => setMatchPaymentId((m) => ({ ...m, [l.id]: e.target.value }))}
                        style={{ width: 160, textAlign: 'left' }}
                      />
                      <Button type="button" variant="secondary" onClick={() => manualMatch(l.id)} disabled={busy || !matchPaymentId[l.id]}>
                        Match
                      </Button>
                    </>
                  )}
                  {batch.status === 'open' && l.matched_payment_id && (
                    <Button type="button" variant="secondary" onClick={() => unmatch(l.id)} disabled={busy}>
                      Unmatch
                    </Button>
                  )}
                </span>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
