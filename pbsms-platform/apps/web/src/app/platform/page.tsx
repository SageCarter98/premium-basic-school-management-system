'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { RestrictedState } from '@/components/states/RestrictedState';
import { apiFetch, apiGet } from '@/lib/api-client';
import { decodeAccessToken, enterImpersonation } from '@/lib/auth-token-store';
import { PLATFORM_ALL, PLATFORM_BILLING, PLATFORM_ONBOARDING, hasAnyPlatformRole } from '@/lib/platform-role-groups';
import styles from '@/styles/tab-hub.module.css';

/**
 * Spec §6.4/§7.1 Platform Console — one tabbed hub, same shape Stage 5/7/8
 * already established for a domain with several sub-screens (Classes,
 * Finance, Curriculum), rather than 9 separate routes for what the
 * screen-inventory table lists as 9 items — several of them (lifecycle
 * actions, plan assignment, metering) are naturally sub-panels of a
 * single tenant's detail view, not standalone screens on their own.
 */

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_id: string | null;
  billing_email: string | null;
  country: string;
  default_currency: string;
  default_timezone: string;
  created_at: string;
  trial_ends_at: string | null;
  suspended_at: string | null;
}
interface Plan {
  id: string;
  code: string;
  name: string;
  billing_basis: string;
  flat_fee_amount: string | null;
  per_student_rate: string | null;
  currency: string;
}
interface AuditEntry {
  id: string;
  actor_id: string | null;
  tenant_id: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}
interface Invoice {
  id: string;
  tenant_id: string;
  billing_cycle: string;
  period_start: string;
  period_end: string;
  active_student_count: number;
  plan_code: string;
  amount: string;
  currency: string;
  status: string;
  payment_reference: string | null;
  issued_at: string;
  paid_at: string | null;
}
interface Grant {
  id: string;
  tenant_id: string;
  granted_to: string;
  support_ticket_ref: string;
  reason: string | null;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
}
interface PlatformUser {
  id: string;
  email: string;
  full_name: string;
  role_codes: string[];
}
interface Metering {
  tenant_id: string;
  name: string;
  active_student_count: number;
}

// Mirrors tenants.service.ts's ALLOWED_TRANSITIONS by hand — the state
// graph itself is a documented backend modeling decision (Chapter 4.1
// names the 7 states, not a literal transition table), not something the
// API exposes for a client to introspect. Same "hand-mirror a small,
// rarely-changing backend constant" call as role-groups.ts.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  trial: ['onboarding', 'closed'],
  onboarding: ['active', 'closed'],
  active: ['past_due', 'offboarding'],
  past_due: ['active', 'suspended'],
  suspended: ['active', 'offboarding'],
  offboarding: ['closed'],
  closed: [],
};

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  trial: 'neutral',
  onboarding: 'neutral',
  active: 'success',
  past_due: 'warning',
  suspended: 'danger',
  offboarding: 'warning',
  closed: 'danger',
};

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = body?.message;
  return (Array.isArray(m) ? m.join('; ') : m) ?? fallback;
}

const TABS = ['Tenants', 'Billing', 'Impersonation', 'Platform Staff', 'Audit Log'] as const;
type Tab = (typeof TABS)[number];

export default function PlatformConsolePage() {
  const [tab, setTab] = useState<Tab>('Tenants');
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canOnboard = hasAnyPlatformRole(roleCodes, PLATFORM_ONBOARDING);
  const canBilling = hasAnyPlatformRole(roleCodes, PLATFORM_BILLING);
  const canImpersonate = roleCodes.includes('support_engineer') || roleCodes.includes('platform_super_admin');
  const isSuperAdmin = roleCodes.includes('platform_super_admin');

  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);

  function reloadTenants() {
    return apiGet<Tenant[]>('/v1/platform/tenants').then(setTenants);
  }

  useEffect(() => {
    Promise.all([reloadTenants(), apiGet<Plan[]>('/v1/platform/billing/plans')])
      .then(([, p]) => setPlans(p))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading Platform Console" rows={4} />
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
        {tab === 'Tenants' && <TenantsTab tenants={tenants} plans={plans} canOnboard={canOnboard} canBilling={canBilling} canImpersonate={canImpersonate} reload={reloadTenants} />}
        {tab === 'Billing' && <BillingTab tenants={tenants} canBilling={canBilling} />}
        {tab === 'Impersonation' && <ImpersonationTab tenants={tenants} canImpersonate={canImpersonate} isSuperAdmin={isSuperAdmin} />}
        {tab === 'Platform Staff' && <PlatformStaffTab isSuperAdmin={isSuperAdmin} />}
        {tab === 'Audit Log' && <AuditLogTab tenants={tenants} />}
      </Card>
    </div>
  );
}

function TenantsTab({
  tenants,
  plans,
  canOnboard,
  canBilling,
  canImpersonate,
  reload,
}: {
  tenants: Tenant[];
  plans: Plan[];
  canOnboard: boolean;
  canBilling: boolean;
  canImpersonate: boolean;
  reload: () => Promise<void>;
}) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', slug: '', billingEmail: '', trialDays: '30' });
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [auditTrail, setAuditTrail] = useState<AuditEntry[]>([]);
  const [transitionForm, setTransitionForm] = useState({ toStatus: '', reason: '', billingMethodConfirmed: false, freeTierApprovalReason: '' });
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ planId: '', billingCycle: 'monthly' });
  const [planError, setPlanError] = useState<string | null>(null);
  const [grantForm, setGrantForm] = useState({ supportTicketRef: '', reason: '' });
  const [grantError, setGrantError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function expand(t: Tenant) {
    if (expandedId === t.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(t.id);
    setTransitionForm({ toStatus: '', reason: '', billingMethodConfirmed: false, freeTierApprovalReason: '' });
    setTransitionError(null);
    setPlanError(null);
    setGrantError(null);
    setAuditTrail(await apiGet<AuditEntry[]>(`/v1/platform/tenants/${t.id}/audit-trail`));
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiFetch('/v1/platform/tenants', {
        method: 'POST',
        body: JSON.stringify({ ...createForm, trialDays: Number(createForm.trialDays) || undefined, billingEmail: createForm.billingEmail || undefined }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setCreateForm({ name: '', slug: '', billingEmail: '', trialDays: '30' });
      setShowCreate(false);
      await reload();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create tenant.');
    } finally {
      setCreating(false);
    }
  }

  async function handleTransition(tenantId: string) {
    setBusy(true);
    setTransitionError(null);
    try {
      const res = await apiFetch(`/v1/platform/tenants/${tenantId}/transition`, {
        method: 'POST',
        body: JSON.stringify({
          toStatus: transitionForm.toStatus,
          reason: transitionForm.reason,
          billingMethodConfirmed: transitionForm.billingMethodConfirmed || undefined,
          freeTierApprovalReason: transitionForm.freeTierApprovalReason || undefined,
        }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      await reload();
      setTransitionForm({ toStatus: '', reason: '', billingMethodConfirmed: false, freeTierApprovalReason: '' });
    } catch (err) {
      setTransitionError(err instanceof Error ? err.message : 'Transition failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAssignPlan(tenantId: string) {
    setBusy(true);
    setPlanError(null);
    try {
      const res = await apiFetch(`/v1/platform/billing/tenants/${tenantId}/plan`, {
        method: 'POST',
        body: JSON.stringify(planForm),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      await reload();
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Could not assign plan.');
    } finally {
      setBusy(false);
    }
  }

  async function handleStartImpersonation(tenant: Tenant) {
    setBusy(true);
    setGrantError(null);
    try {
      const grantRes = await apiFetch('/v1/platform/impersonation', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tenant.id, supportTicketRef: grantForm.supportTicketRef, reason: grantForm.reason || undefined }),
      });
      if (!grantRes.ok) throw new Error(await errorMessage(grantRes, `Failed (${grantRes.status})`));
      const grant = (await grantRes.json()) as Grant;
      const tokenRes = await apiFetch(`/v1/platform/impersonation/${grant.id}/token`, { method: 'POST' });
      if (!tokenRes.ok) throw new Error(await errorMessage(tokenRes, `Failed (${tokenRes.status})`));
      const { accessToken } = (await tokenRes.json()) as { accessToken: string; expiresAt: string };
      enterImpersonation(accessToken, { ticketRef: grant.support_ticket_ref, tenantName: tenant.name });
      router.push('/dashboard');
    } catch (err) {
      setGrantError(err instanceof Error ? err.message : 'Could not start impersonation session.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {canOnboard && (
        <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
          {showCreate ? 'Cancel' : 'New tenant'}
        </Button>
      )}
      {showCreate && (
        <div style={{ marginBottom: 'var(--pb-space-3)' }}>
          <div className={styles.formRow}>
            <input aria-label="School name" className={styles.textInput} placeholder="School name" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            <input aria-label="Slug" className={styles.textInput} placeholder="Slug" value={createForm.slug} onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })} />
            <input aria-label="Billing email" className={styles.textInput} placeholder="Billing email (optional)" value={createForm.billingEmail} onChange={(e) => setCreateForm({ ...createForm, billingEmail: e.target.value })} />
            <input aria-label="Trial days" className={styles.textInput} type="number" placeholder="Trial days" value={createForm.trialDays} onChange={(e) => setCreateForm({ ...createForm, trialDays: e.target.value })} />
          </div>
          <Button type="button" onClick={handleCreate} disabled={creating || !createForm.name || !createForm.slug}>
            Create
          </Button>
          {createError && <ErrorState message={createError} />}
        </div>
      )}

      {tenants.length === 0 ? (
        <EmptyState title="No tenants yet" message="Create one to get started." />
      ) : (
        tenants.map((t) => {
          const plan = plans.find((p) => p.id === t.plan_id);
          const nextStatuses = ALLOWED_TRANSITIONS[t.status] ?? [];
          return (
            <div key={t.id}>
              <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => expand(t)}>
                <span>
                  {t.name} <span className={styles.hint}>({t.slug})</span>
                </span>
                <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                  <span className={styles.hint}>{plan?.name ?? 'no plan'}</span>
                  <Pill variant={STATUS_VARIANT[t.status] ?? 'neutral'}>{t.status.replace('_', ' ')}</Pill>
                </span>
              </div>
              {expandedId === t.id && (
                <div className={styles.detailPanel}>
                  <p className={styles.hint}>
                    Viewing: <strong>{t.name}</strong> · {t.country} · {t.default_currency} · {t.default_timezone} · created {new Date(t.created_at).toLocaleDateString()}
                    {t.trial_ends_at && <> · trial ends {new Date(t.trial_ends_at).toLocaleDateString()}</>}
                  </p>

                  {nextStatuses.length > 0 ? (
                    <div className={styles.formRow}>
                      <select aria-label="Transition to" className={styles.select} value={transitionForm.toStatus} onChange={(e) => setTransitionForm({ ...transitionForm, toStatus: e.target.value })}>
                        <option value="">Transition to…</option>
                        {nextStatuses.map((s) => (
                          <option key={s} value={s}>
                            {s.replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                      <input aria-label="Reason" className={styles.textInput} placeholder="Reason (required)" value={transitionForm.reason} onChange={(e) => setTransitionForm({ ...transitionForm, reason: e.target.value })} />
                      {t.status === 'trial' && transitionForm.toStatus === 'onboarding' && (
                        <>
                          <label className={styles.hint} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input type="checkbox" checked={transitionForm.billingMethodConfirmed} onChange={(e) => setTransitionForm({ ...transitionForm, billingMethodConfirmed: e.target.checked })} />
                            Billing method confirmed
                          </label>
                          <input
                            aria-label="Free-tier approval reason"
                            className={styles.textInput}
                            placeholder="or free-tier approval reason"
                            value={transitionForm.freeTierApprovalReason}
                            onChange={(e) => setTransitionForm({ ...transitionForm, freeTierApprovalReason: e.target.value })}
                          />
                        </>
                      )}
                      <Button type="button" variant="secondary" onClick={() => handleTransition(t.id)} disabled={busy || !transitionForm.toStatus || !transitionForm.reason}>
                        Apply
                      </Button>
                    </div>
                  ) : (
                    <p className={styles.hint}>&apos;{t.status}&apos; is terminal — no further transitions.</p>
                  )}
                  {transitionError && <ErrorState message={transitionError} />}

                  {canBilling && (
                    <div className={styles.formRow} style={{ marginTop: 'var(--pb-space-3)' }}>
                      <select aria-label="Assign plan" className={styles.select} value={planForm.planId} onChange={(e) => setPlanForm({ ...planForm, planId: e.target.value })}>
                        <option value="">Assign plan…</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.billing_basis === 'flat' ? `${p.flat_fee_amount} ${p.currency} flat` : `${p.per_student_rate} ${p.currency}/student`})
                          </option>
                        ))}
                      </select>
                      <select aria-label="Billing cycle" className={styles.select} value={planForm.billingCycle} onChange={(e) => setPlanForm({ ...planForm, billingCycle: e.target.value })}>
                        <option value="monthly">Monthly</option>
                        <option value="termly">Termly</option>
                      </select>
                      <Button type="button" variant="secondary" onClick={() => handleAssignPlan(t.id)} disabled={busy || !planForm.planId}>
                        Assign
                      </Button>
                    </div>
                  )}
                  {planError && <ErrorState message={planError} />}

                  {canImpersonate && (
                    <div className={styles.formRow} style={{ marginTop: 'var(--pb-space-3)' }}>
                      <input aria-label="Support ticket number" className={styles.textInput} placeholder="Support ticket # (required)" value={grantForm.supportTicketRef} onChange={(e) => setGrantForm({ ...grantForm, supportTicketRef: e.target.value })} />
                      <input aria-label="Reason" className={styles.textInput} placeholder="Reason (optional)" value={grantForm.reason} onChange={(e) => setGrantForm({ ...grantForm, reason: e.target.value })} />
                      <Button type="button" variant="secondary" onClick={() => handleStartImpersonation(t)} disabled={busy || !grantForm.supportTicketRef}>
                        Start impersonation session
                      </Button>
                    </div>
                  )}
                  {grantError && <ErrorState message={grantError} />}

                  <p className={styles.hint} style={{ marginTop: 'var(--pb-space-3)' }}>
                    Audit trail
                  </p>
                  {auditTrail.length === 0 ? (
                    <EmptyState title="No platform actions recorded for this tenant yet" message="" />
                  ) : (
                    auditTrail.map((a) => (
                      <div key={a.id} className={styles.listRow}>
                        <span>{a.action.replace(/_/g, ' ')}</span>
                        <span className={styles.hint}>{new Date(a.created_at).toLocaleString()}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function BillingTab({ tenants, canBilling }: { tenants: Tenant[]; canBilling: boolean }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [metering, setMetering] = useState<Metering[]>([]);
  const [loading, setLoading] = useState(true);
  const [genForm, setGenForm] = useState({ tenantId: '', periodStart: '', periodEnd: '' });
  const [genError, setGenError] = useState<string | null>(null);
  const [payRef, setPayRef] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revenue, setRevenue] = useState<{ mrr: string; invoiceTotalsByStatus: { status: string; total: string; count: string }[]; tenantCountsByStatus: { status: string; count: string }[] } | null>(null);
  const [revenueRange, setRevenueRange] = useState({ periodStart: '', periodEnd: '' });

  function reload() {
    return Promise.all([apiGet<Invoice[]>('/v1/platform/billing/invoices'), apiGet<Metering[]>('/v1/platform/billing/metering')]).then(([i, m]) => {
      setInvoices(i);
      setMetering(m);
    });
  }
  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  function tenantName(id: string) {
    return tenants.find((t) => t.id === id)?.name ?? id;
  }

  async function handleGenerate() {
    setBusy(true);
    setGenError(null);
    try {
      const res = await apiFetch(`/v1/platform/billing/tenants/${genForm.tenantId}/invoices`, {
        method: 'POST',
        body: JSON.stringify({ periodStart: genForm.periodStart, periodEnd: genForm.periodEnd }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      await reload();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Could not generate invoice.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePay(invoiceId: string) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/v1/platform/billing/invoices/${invoiceId}/pay`, { method: 'POST', body: JSON.stringify({ reference: payRef[invoiceId] ?? '' }) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not record payment.');
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkOverdue(invoiceId: string) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/v1/platform/billing/invoices/${invoiceId}/mark-overdue`, { method: 'POST' });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not mark overdue.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDunning(tenantId: string) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/v1/platform/billing/tenants/${tenantId}/dunning/advance`, { method: 'POST', body: JSON.stringify({ reason: 'Overdue platform invoice — dunning advanced from Platform Console' }) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not advance dunning.');
    } finally {
      setBusy(false);
    }
  }

  async function loadRevenue() {
    if (!revenueRange.periodStart || !revenueRange.periodEnd) return;
    const data = await apiGet<typeof revenue>(`/v1/platform/billing/revenue-report?periodStart=${revenueRange.periodStart}&periodEnd=${revenueRange.periodEnd}`);
    setRevenue(data);
  }

  if (loading) return <LoadingState label="Loading billing" rows={4} />;

  return (
    <div>
      <p className={styles.hint}>Revenue dashboard (MRR, invoice totals, tenant status counts)</p>
      <div className={styles.formRow}>
        <input aria-label="Revenue report period start" className={styles.textInput} type="date" value={revenueRange.periodStart} onChange={(e) => setRevenueRange({ ...revenueRange, periodStart: e.target.value })} />
        <input aria-label="Revenue report period end" className={styles.textInput} type="date" value={revenueRange.periodEnd} onChange={(e) => setRevenueRange({ ...revenueRange, periodEnd: e.target.value })} />
        <Button type="button" onClick={loadRevenue} disabled={!revenueRange.periodStart || !revenueRange.periodEnd}>
          Load
        </Button>
      </div>
      {revenue && (
        <div className={styles.statRow} style={{ marginBottom: 'var(--pb-space-4)' }}>
          <div className={styles.statTile}>
            <div className={styles.statTileValue}>{Number(revenue.mrr).toFixed(2)}</div>
            <div className={styles.statTileLabel}>MRR (GHS)</div>
          </div>
          {revenue.tenantCountsByStatus.map((c) => (
            <div key={c.status} className={styles.statTile}>
              <div className={styles.statTileValue}>{c.count}</div>
              <div className={styles.statTileLabel}>{c.status.replace('_', ' ')} tenants</div>
            </div>
          ))}
        </div>
      )}
      <p className={styles.hint}>Note: true churn/expansion cohort analysis (ARPU trend) is not computed — see billing.service.ts&apos;s own header for why.</p>

      <p className={styles.hint} style={{ marginTop: 'var(--pb-space-4)' }}>
        Metering — live active-student count per tenant
      </p>
      {metering.map((m) => (
        <div key={m.tenant_id} className={styles.listRow}>
          <span>{m.name}</span>
          <span>{m.active_student_count} active students</span>
        </div>
      ))}

      {canBilling && (
        <>
          <p className={styles.hint} style={{ marginTop: 'var(--pb-space-4)' }}>
            Generate invoice
          </p>
          <div className={styles.formRow}>
            <select aria-label="Tenant" className={styles.select} value={genForm.tenantId} onChange={(e) => setGenForm({ ...genForm, tenantId: e.target.value })}>
              <option value="">Tenant…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input aria-label="Invoice period start" className={styles.textInput} type="date" value={genForm.periodStart} onChange={(e) => setGenForm({ ...genForm, periodStart: e.target.value })} />
            <input aria-label="Invoice period end" className={styles.textInput} type="date" value={genForm.periodEnd} onChange={(e) => setGenForm({ ...genForm, periodEnd: e.target.value })} />
            <Button type="button" onClick={handleGenerate} disabled={busy || !genForm.tenantId || !genForm.periodStart || !genForm.periodEnd}>
              Generate
            </Button>
          </div>
          {genError && <ErrorState message={genError} />}
        </>
      )}

      <p className={styles.hint} style={{ marginTop: 'var(--pb-space-4)' }}>
        Platform invoices
      </p>
      {actionError && <ErrorState message={actionError} />}
      {invoices.length === 0 ? (
        <EmptyState title="No platform invoices yet" message="" />
      ) : (
        invoices.map((inv) => (
          <div key={inv.id} className={styles.detailPanel} style={{ marginBottom: 'var(--pb-space-2)' }}>
            <div className={styles.listRow}>
              <span>
                {tenantName(inv.tenant_id)} — {inv.plan_code} — {inv.period_start} → {inv.period_end}
              </span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                <span>
                  {inv.amount} {inv.currency}
                </span>
                <Pill variant={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : 'neutral'}>{inv.status}</Pill>
              </span>
            </div>
            {canBilling && inv.status !== 'paid' && (
              <div className={styles.formRow}>
                {inv.status === 'issued' && (
                  <>
                    <input aria-label="Payment reference" className={styles.textInput} placeholder="Payment reference" value={payRef[inv.id] ?? ''} onChange={(e) => setPayRef({ ...payRef, [inv.id]: e.target.value })} />
                    <Button type="button" variant="secondary" onClick={() => handlePay(inv.id)} disabled={busy || !payRef[inv.id]}>
                      Record payment
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => handleMarkOverdue(inv.id)} disabled={busy}>
                      Mark overdue
                    </Button>
                  </>
                )}
                {inv.status === 'overdue' && (
                  <>
                    <input aria-label="Payment reference" className={styles.textInput} placeholder="Payment reference" value={payRef[inv.id] ?? ''} onChange={(e) => setPayRef({ ...payRef, [inv.id]: e.target.value })} />
                    <Button type="button" variant="secondary" onClick={() => handlePay(inv.id)} disabled={busy || !payRef[inv.id]}>
                      Record payment
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => handleDunning(inv.tenant_id)} disabled={busy}>
                      Advance dunning
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function ImpersonationTab({ tenants, canImpersonate, isSuperAdmin }: { tenants: Tenant[]; canImpersonate: boolean; isSuperAdmin: boolean }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalGrantId, setApprovalGrantId] = useState<string>('');
  const [actionType, setActionType] = useState('financial_reversal');
  const [requestedApprovalId, setRequestedApprovalId] = useState<string | null>(null);
  const [approveId, setApproveId] = useState('');
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveResult, setApproveResult] = useState<string | null>(null);

  function reload() {
    return apiGet<Grant[]>('/v1/platform/impersonation').then(setGrants);
  }
  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  function tenantName(id: string) {
    return tenants.find((t) => t.id === id)?.name ?? id;
  }

  async function handleEnd(grantId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/v1/platform/impersonation/${grantId}/end`, { method: 'POST' });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not end grant.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestApproval() {
    if (!approvalGrantId) return;
    setBusy(true);
    setError(null);
    setRequestedApprovalId(null);
    try {
      const res = await apiFetch(`/v1/platform/impersonation/${approvalGrantId}/sensitive-approvals`, { method: 'POST', body: JSON.stringify({ actionType }) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      const approval = (await res.json()) as { id: string };
      setRequestedApprovalId(approval.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request approval.');
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    if (!approveId) return;
    setBusy(true);
    setApproveError(null);
    setApproveResult(null);
    try {
      const res = await apiFetch(`/v1/platform/impersonation/sensitive-approvals/${approveId}/approve`, { method: 'POST' });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setApproveResult('Approved.');
      setApproveId('');
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Could not approve.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading impersonation grants" rows={3} />;
  if (!canImpersonate) {
    return <RestrictedState message="Impersonation is available to Support Engineers and platform_super_admin only." />;
  }

  return (
    <div>
      <p className={styles.hint}>Active grants are started from a tenant&apos;s own detail panel on the Tenants tab (a support ticket # is required, TEN-021).</p>
      {error && <ErrorState message={error} />}
      {grants.length === 0 ? (
        <EmptyState title="No impersonation grants" message="" />
      ) : (
        grants.map((g) => (
          <div key={g.id} className={styles.listRow}>
            <span>
              {tenantName(g.tenant_id)} — ticket #{g.support_ticket_ref}
            </span>
            <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
              <span className={styles.hint}>expires {new Date(g.expires_at).toLocaleTimeString()}</span>
              <Pill variant={g.revoked_at ? 'danger' : new Date(g.expires_at) < new Date() ? 'neutral' : 'success'}>{g.revoked_at ? 'ended' : new Date(g.expires_at) < new Date() ? 'expired' : 'active'}</Pill>
              {!g.revoked_at && (
                <Button type="button" variant="secondary" onClick={() => handleEnd(g.id)} disabled={busy}>
                  End
                </Button>
              )}
            </span>
          </div>
        ))
      )}

      {/* Gated by canImpersonate (support_engineer or platform_super_admin),
          matching requestSensitiveApproval's real backend guard — NOT
          isSuperAdmin. Gating this to isSuperAdmin alone would mean the
          only user who could ever click it is also the only user who can
          approve, and the backend's own four-eyes check
          (requester !== approver) would then reject every request this UI
          could produce. Support Engineer is the role TEN-021 actually
          names as the requester. */}
      {canImpersonate && (
        <div style={{ marginTop: 'var(--pb-space-4)' }}>
          <p className={styles.hint}>Sensitive-action four-eyes approval (TEN-021) — the requester cannot also approve.</p>
          <div className={styles.formRow}>
            <select aria-label="Grant" className={styles.select} value={approvalGrantId} onChange={(e) => setApprovalGrantId(e.target.value)}>
              <option value="">Grant…</option>
              {grants
                .filter((g) => !g.revoked_at)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {tenantName(g.tenant_id)} — #{g.support_ticket_ref}
                  </option>
                ))}
            </select>
            <select aria-label="Action type" className={styles.select} value={actionType} onChange={(e) => setActionType(e.target.value)}>
              <option value="financial_reversal">Financial reversal</option>
              <option value="data_export">Data export</option>
              <option value="permission_change">Permission change</option>
            </select>
            <Button type="button" variant="secondary" onClick={handleRequestApproval} disabled={busy || !approvalGrantId}>
              Request approval
            </Button>
          </div>
          {requestedApprovalId && (
            <p className={styles.hint}>
              Requested — approval id <strong>{requestedApprovalId}</strong>. Share this with a different platform_super_admin to approve.
            </p>
          )}
        </div>
      )}

      {/* No backend endpoint lists pending sensitive-action approvals
          (only create + approve exist) — the requester above passes the
          approval id along (e.g. via the support ticket) the same way
          support_ticket_ref itself is communicated out of band, rather
          than this screen inventing a list view over a read path that
          doesn't exist. */}
      {isSuperAdmin && (
        <div style={{ marginTop: 'var(--pb-space-4)' }}>
          <p className={styles.hint}>Approve a sensitive-action request (platform_super_admin only, cannot approve your own request).</p>
          <div className={styles.formRow}>
            <input aria-label="Approval id" className={styles.textInput} placeholder="Approval id" value={approveId} onChange={(e) => setApproveId(e.target.value)} />
            <Button type="button" variant="secondary" onClick={handleApprove} disabled={busy || !approveId}>
              Approve
            </Button>
          </div>
          {approveError && <ErrorState message={approveError} />}
          {approveResult && <p className={styles.hint}>{approveResult}</p>}
        </div>
      )}
    </div>
  );
}

function PlatformStaffTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grantForm, setGrantForm] = useState({ userId: '', roleCode: 'support_engineer' });

  function reload() {
    return apiGet<PlatformUser[]>('/v1/platform/staff').then(setUsers);
  }
  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  async function handleGrant() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/v1/platform/staff/${grantForm.userId}/roles`, { method: 'POST', body: JSON.stringify({ roleCode: grantForm.roleCode }) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not grant role.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(userId: string, roleCode: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/v1/platform/staff/${userId}/roles/${roleCode}/revoke`, { method: 'POST' });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke role.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading platform staff" rows={3} />;

  return (
    <div>
      <p className={styles.hint}>Chapter 3.1 — grant/revoke is break-glass, platform_super_admin only. Reading is open to any platform role.</p>
      {error && <ErrorState message={error} />}
      {users.length === 0 ? (
        <EmptyState title="No platform users" message="" />
      ) : (
        users.map((u) => (
          <div key={u.id} className={styles.listRow}>
            <span>
              {u.full_name} <span className={styles.hint}>({u.email})</span>
            </span>
            <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              {u.role_codes.length === 0 ? (
                <span className={styles.hint}>no active roles</span>
              ) : (
                u.role_codes.map((rc) => (
                  <Pill key={rc} variant="neutral">
                    {rc.replace(/_/g, ' ')}
                    {isSuperAdmin && (
                      <button type="button" onClick={() => handleRevoke(u.id, rc)} disabled={busy} style={{ marginLeft: 6, border: 'none', background: 'none', cursor: 'pointer' }} aria-label={`Revoke ${rc}`}>
                        ✕
                      </button>
                    )}
                  </Pill>
                ))
              )}
            </span>
          </div>
        ))
      )}

      {isSuperAdmin && (
        <div className={styles.formRow} style={{ marginTop: 'var(--pb-space-3)' }}>
          <input aria-label="User id" className={styles.textInput} placeholder="User id (must already exist, is_platform_user=true)" value={grantForm.userId} onChange={(e) => setGrantForm({ ...grantForm, userId: e.target.value })} />
          <select aria-label="Role to grant" className={styles.select} value={grantForm.roleCode} onChange={(e) => setGrantForm({ ...grantForm, roleCode: e.target.value })}>
            <option value="platform_super_admin">Platform super admin</option>
            <option value="support_engineer">Support engineer</option>
            <option value="billing_administrator">Billing administrator</option>
            <option value="onboarding_specialist">Onboarding specialist</option>
          </select>
          <Button type="button" variant="secondary" onClick={handleGrant} disabled={busy || !grantForm.userId}>
            Grant
          </Button>
        </div>
      )}
    </div>
  );
}

function AuditLogTab({ tenants }: { tenants: Tenant[] }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantFilter, setTenantFilter] = useState('');

  function reload(tenantId: string) {
    const qs = tenantId ? `?tenantId=${tenantId}` : '';
    return apiGet<AuditEntry[]>(`/v1/platform/tenants/audit-log${qs}`).then(setEntries);
  }
  useEffect(() => {
    reload('').finally(() => setLoading(false));
  }, []);

  function tenantName(id: string | null) {
    if (!id) return '(platform-wide)';
    return tenants.find((t) => t.id === id)?.name ?? id;
  }

  if (loading) return <LoadingState label="Loading platform audit log" rows={4} />;

  return (
    <div>
      <div className={styles.formRow}>
        <select
          aria-label="Filter by tenant"
          className={styles.select}
          value={tenantFilter}
          onChange={(e) => {
            setTenantFilter(e.target.value);
            reload(e.target.value);
          }}
        >
          <option value="">All tenants</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {entries.length === 0 ? (
        <EmptyState title="No platform audit entries" message="" />
      ) : (
        entries.map((a) => (
          <div key={a.id} className={styles.listRow}>
            <span>
              {a.action.replace(/_/g, ' ')} — {tenantName(a.tenant_id)}
            </span>
            <span className={styles.hint}>{new Date(a.created_at).toLocaleString()}</span>
          </div>
        ))
      )}
      <p className={styles.hint} style={{ marginTop: 'var(--pb-space-3)' }}>
        Shows the most recent 200 entries. Genuinely blocked, not deferred by choice: a TENANT&apos;s own audit_log has no read endpoint anywhere in this backend either (only written by AuditLogInterceptor) — this view is platform_audit_logs only, the platform-actor side of TEN-022, not a general audit viewer.
      </p>
    </div>
  );
}
