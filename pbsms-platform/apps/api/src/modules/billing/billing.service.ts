/**
 * billing.service.ts
 *
 * Implements SRS v2.1 Chapter 5 (Subscription, Billing & Metering) — the
 * last piece of the Chapter 3-5 Platform Foundation initiative. See
 * 0024_billing.sql's header for the schema/function design.
 *
 * FR-BIL-030 ("accept platform-invoice payment via the same Ghanaian
 * payment rails... plus bank transfer and card"): only bank_transfer is
 * real here — same "don't let a stub be mistaken for a real control"
 * instinct finance.service.ts's recordPayment() already established for
 * mobile_money/card. Real Paystack/Hubtel/card acceptance is blocked on
 * the same Appendix E vendor onboarding as Finance's own gap, not
 * attempted here.
 *
 * FR-BIL-040 (dunning): runDunningStep() does the REAL half — it
 * transitions the tenant's actual status via TenantsService (past_due /
 * suspended, both genuinely real since Phase A1) — but does NOT send the
 * "notified... by email and WhatsApp" half. That needs a platform-context
 * request to write into a SPECIFIC tenant's CommunicationService, which
 * requires TenantDatabaseService (Scope.REQUEST, tied to an actual
 * incoming HTTP request's lifecycle) — manually constructing one outside
 * Nest's DI is exactly the trap that caused Authorization Pass 1's real
 * bug #1 (a Scope.REQUEST provider silently unresolved when
 * constructor-injected into a global enhancer). Deliberately not
 * attempted here; a real fix needs either Phase D's job infrastructure or
 * a dedicated platform-to-tenant notification bridge, not a workaround
 * bolted onto this pass.
 *
 * FR-BIL-050 (revenue report): MRR and per-period invoiced/paid/overdue
 * totals are real, computed from live data. True churn/expansion cohort
 * analysis (comparing tenant sets period-over-period) is NOT built —
 * flagged as a separate, larger analytics feature rather than faked with
 * a shallow proxy number.
 */

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PLATFORM_POOL } from '../../common/database/database.module';
import { TenantsService } from '../tenants/tenants.service';

export interface TenantSubscription {
  id: string;
  tenant_id: string;
  plan_id: string;
  billing_cycle: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  ended_at: string | null;
}

export interface PlatformInvoice {
  id: string;
  tenant_id: string;
  tenant_subscription_id: string;
  billing_cycle: string;
  period_start: string;
  period_end: string;
  active_student_count: number;
  plan_code: string;
  amount: string;
  currency: string;
  status: string;
  payment_method: string | null;
  payment_reference: string | null;
  issued_at: string;
  paid_at: string | null;
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(PLATFORM_POOL) private readonly pool: Pool,
    private readonly tenants: TenantsService,
  ) {}

  async assignPlan(
    actorId: string,
    tenantId: string,
    planId: string,
    billingCycle: string,
  ): Promise<TenantSubscription> {
    await this.tenants.findOne(tenantId); // 404s if the tenant doesn't exist
    const planRows = await this.pool.query<{ id: string }>(`select id from plans where id = $1`, [planId]);
    if (planRows.rows.length === 0) {
      throw new NotFoundException(`Plan ${planId} not found`);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `update tenant_subscriptions set status = 'ended', ended_at = now() where tenant_id = $1 and status = 'active'`,
        [tenantId],
      );
      const result = await client.query<TenantSubscription>(
        `insert into tenant_subscriptions (tenant_id, plan_id, billing_cycle, created_by)
         values ($1, $2, $3, $4)
         returning *`,
        [tenantId, planId, billingCycle, actorId],
      );
      // Keeps tenants.plan_id (Phase A1's TEN-023 gate) in sync with the
      // real subscription record this migration introduces.
      await client.query(`update tenants set plan_id = $1 where id = $2`, [planId, tenantId]);
      await client.query(
        `insert into platform_audit_logs (actor_id, tenant_id, action, detail) values ($1, $2, 'plan_assigned', $3)`,
        [actorId, tenantId, JSON.stringify({ planId, billingCycle })],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async generateInvoice(
    actorId: string,
    tenantId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<PlatformInvoice> {
    const subRows = await this.pool.query<TenantSubscription & { billing_basis: string; flat_fee_amount: string | null; per_student_rate: string | null; currency: string; code: string }>(
      `select ts.*, p.billing_basis, p.flat_fee_amount, p.per_student_rate, p.currency, p.code
       from tenant_subscriptions ts join plans p on p.id = ts.plan_id
       where ts.tenant_id = $1 and ts.status = 'active'`,
      [tenantId],
    );
    if (subRows.rows.length === 0) {
      throw new ConflictException(`Tenant ${tenantId} has no active subscription — assign a plan first`);
    }
    const sub = subRows.rows[0];

    const activeStudentRows = await this.pool.query<{ count_active_students: number }>(
      `select count_active_students($1)`,
      [tenantId],
    );
    const activeStudentCount = activeStudentRows.rows[0].count_active_students;

    const amount =
      sub.billing_basis === 'flat' ? Number(sub.flat_fee_amount) : Number(sub.per_student_rate) * activeStudentCount;

    const result = await this.pool.query<PlatformInvoice>(
      `insert into platform_invoices
         (tenant_id, tenant_subscription_id, billing_cycle, period_start, period_end, active_student_count, plan_code, amount, currency, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning *`,
      [tenantId, sub.id, sub.billing_cycle, periodStart, periodEnd, activeStudentCount, sub.code, amount, sub.currency, actorId],
    );
    const invoice = result.rows[0];

    await this.pool.query(
      `insert into platform_audit_logs (actor_id, tenant_id, action, detail) values ($1, $2, 'platform_invoice_generated', $3)`,
      [actorId, tenantId, JSON.stringify({ invoiceId: invoice.id, amount, activeStudentCount })],
    );

    return invoice;
  }

  async listInvoices(filter: { tenantId?: string; status?: string }): Promise<PlatformInvoice[]> {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.tenantId) {
      params.push(filter.tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
    const result = await this.pool.query<PlatformInvoice>(
      `select * from platform_invoices ${where} order by issued_at desc`,
      params,
    );
    return result.rows;
  }

  async recordInvoicePayment(actorId: string, invoiceId: string, reference: string): Promise<PlatformInvoice> {
    // Only bank_transfer accepted — see this file's header for why
    // card/mobile_money aren't a DTO option at all, same shape as
    // finance.service.ts's recordPayment() rejecting those explicitly.
    const result = await this.pool.query<PlatformInvoice>(
      `update platform_invoices set status = 'paid', payment_method = 'bank_transfer', payment_reference = $1, paid_at = now()
       where id = $2 and status in ('issued', 'overdue')
       returning *`,
      [reference, invoiceId],
    );
    if (result.rows.length === 0) {
      // Distinguish "doesn't exist" from "already paid/cancelled".
      const existing = await this.pool.query<{ status: string }>(`select status from platform_invoices where id = $1`, [
        invoiceId,
      ]);
      if (existing.rows.length === 0) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }
      throw new ConflictException(`Invoice ${invoiceId} is '${existing.rows[0].status}', not payable`);
    }
    const invoice = result.rows[0];

    await this.pool.query(
      `insert into platform_audit_logs (actor_id, tenant_id, action, detail) values ($1, $2, 'platform_invoice_paid', $3)`,
      [actorId, invoice.tenant_id, JSON.stringify({ invoiceId, reference })],
    );

    return invoice;
  }

  async markInvoiceOverdue(actorId: string, invoiceId: string): Promise<PlatformInvoice> {
    const result = await this.pool.query<PlatformInvoice>(
      `update platform_invoices set status = 'overdue' where id = $1 and status = 'issued' returning *`,
      [invoiceId],
    );
    if (result.rows.length === 0) {
      throw new ConflictException(`Invoice ${invoiceId} not found or not in 'issued' status`);
    }
    return result.rows[0];
  }

  /** FR-BIL-040's real half — see this file's header for what's
   * deliberately NOT done here (the notification dispatch). */
  async runDunningStep(actorId: string, tenantId: string, reason: string): Promise<{ tenantStatus: string; notificationDeferred: true }> {
    const overdueRows = await this.pool.query<{ hit: number }>(
      `select 1 as hit from platform_invoices where tenant_id = $1 and status = 'overdue' limit 1`,
      [tenantId],
    );
    if (overdueRows.rows.length === 0) {
      throw new ConflictException(`Tenant ${tenantId} has no overdue platform invoice — nothing to dun`);
    }

    const tenant = await this.tenants.findOne(tenantId);
    const nextStatus = tenant.status === 'active' ? 'past_due' : tenant.status === 'past_due' ? 'suspended' : null;
    if (!nextStatus) {
      throw new ConflictException(`Tenant ${tenantId} is '${tenant.status}' — dunning only advances active/past_due`);
    }

    const updated = await this.tenants.transition(tenantId, actorId, { toStatus: nextStatus, reason });

    await this.pool.query(
      `insert into platform_audit_logs (actor_id, tenant_id, action, detail) values ($1, $2, 'dunning_step', $3)`,
      [actorId, tenantId, JSON.stringify({ toStatus: nextStatus, reason, notificationDeferred: true })],
    );

    return { tenantStatus: updated.status, notificationDeferred: true };
  }

  async revenueReport(periodStart: string, periodEnd: string) {
    const invoiceTotals = await this.pool.query<{ status: string; total: string; count: string }>(
      `select status, coalesce(sum(amount), 0) as total, count(*) as count
       from platform_invoices
       where period_start >= $1 and period_end <= $2
       group by status`,
      [periodStart, periodEnd],
    );

    // MRR: current run-rate from ACTIVE subscriptions (not historical
    // invoices) — the standard MRR definition. termly plans normalized
    // /3 to a monthly-equivalent figure.
    const mrrRows = await this.pool.query<{ mrr: string }>(
      `select coalesce(sum(
         case when p.billing_basis = 'flat' then p.flat_fee_amount else p.per_student_rate * count_active_students(ts.tenant_id) end
         / case when ts.billing_cycle = 'termly' then 3 else 1 end
       ), 0) as mrr
       from tenant_subscriptions ts join plans p on p.id = ts.plan_id
       where ts.status = 'active'`,
    );

    const tenantCounts = await this.pool.query<{ status: string; count: string }>(
      `select status, count(*) as count from tenants group by status`,
    );

    return {
      periodStart,
      periodEnd,
      mrr: mrrRows.rows[0].mrr,
      invoiceTotalsByStatus: invoiceTotals.rows,
      tenantCountsByStatus: tenantCounts.rows,
      note: 'Churn/expansion cohort analysis not computed — see billing.service.ts header for why.',
    };
  }
}
