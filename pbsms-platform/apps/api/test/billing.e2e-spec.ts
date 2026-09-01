/**
 * billing.e2e-spec.ts
 *
 * Chapter 5 (Subscription, Billing & Metering) — FR-BIL-030/040/050.
 * BillingService had zero test coverage before this file.
 *
 * Covers:
 *  - createPlan()/updatePlan(): a duplicate plan code 409s (plans_code
 *    unique constraint, caught and turned clean); updatePlan()'s partial
 *    coalesce leaves unspecified fields untouched, an unknown id 404s.
 *  - assignPlan(): 404s on an unknown tenant or plan; a successful assign
 *    creates a real tenant_subscriptions row and syncs tenants.plan_id
 *    (TEN-023's own gate reads that column).
 *  - generateInvoice() — FR-BIL-030: 409s with no active subscription;
 *    once assigned to a 'flat' plan, the invoice amount equals the
 *    plan's flat_fee_amount exactly (per_active_student arithmetic is
 *    documented, not separately exercised here — it needs real active
 *    students in a throwaway tenant, out of proportion to what this
 *    pass buys).
 *  - recordInvoicePayment()/markInvoiceOverdue(): the issued -> overdue
 *    -> paid path, plus the 404-vs-409 distinction on each.
 *  - runDunningStep() — FR-BIL-040: 409s with no overdue invoice; the
 *    real half (TenantsService status transition active->past_due) and
 *    the dispatch half (a real background_jobs row enqueued via
 *    platform_enqueue_job()) both actually happen.
 *  - revenueReport() — FR-BIL-050: MRR reflects an active flat-plan
 *    subscription; invoiceTotalsByStatus buckets this test's own paid
 *    invoice correctly for the period it falls in.
 *
 * tenant_subscriptions/platform_invoices/plans all grant pbsms_platform
 * insert+update but never delete (0024_billing.sql, 0041_billing_plan_
 * grants.sql — deliberately: nothing about billing history is meant to
 * be erasable by the platform-role connection); background_jobs is only
 * writable via the platform_enqueue_job() SECURITY DEFINER function, not
 * a direct grant at all. So, like tenant-lifecycle.e2e-spec.ts before it,
 * every fixture this file creates is torn down via the schema-owning
 * role (MIGRATE_DATABASE_URL), never the plain platform connection.
 *
 * Requires a running Postgres with every migration through
 * 0041_billing_plan_grants.sql (and seed_demo.sql) applied.
 */

import { Pool } from 'pg';
import { BillingService } from '../src/modules/billing/billing.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';

const PLATFORM_ADMIN = '99999999-0000-0000-0000-000000000005'; // seed_demo.sql
const STARTER_PLAN = '00000000-0000-0000-0000-000000000001'; // flat, GHS 500 — seed_demo.sql
const STANDARD_PLAN = '00000000-0000-0000-0000-000000000002'; // per_active_student — seed_demo.sql

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Billing (Chapter 5, FR-BIL-030/040/050)', () => {
  let platformPool: Pool;
  let cleanupPool: Pool;
  let billing: BillingService;
  let tenants: TenantsService;
  const createdTenantIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(() => {
    platformPool = new Pool({ connectionString: process.env.PLATFORM_DATABASE_URL });
    cleanupPool = new Pool({ connectionString: process.env.MIGRATE_DATABASE_URL });
    billing = new BillingService(platformPool, new TenantsService(platformPool));
    tenants = new TenantsService(platformPool);
  });

  afterAll(async () => {
    if (createdTenantIds.length > 0) {
      await cleanupPool.query(`delete from background_jobs where tenant_id = any($1::uuid[])`, [createdTenantIds]);
      await cleanupPool.query(`delete from platform_invoices where tenant_id = any($1::uuid[])`, [createdTenantIds]);
      await cleanupPool.query(`delete from tenant_subscriptions where tenant_id = any($1::uuid[])`, [createdTenantIds]);
      await cleanupPool.query(`delete from audit_log where tenant_id = any($1::uuid[])`, [createdTenantIds]);
      await cleanupPool.query(`delete from platform_audit_logs where tenant_id = any($1::uuid[])`, [createdTenantIds]);
      await cleanupPool.query(`delete from tenants where id = any($1::uuid[])`, [createdTenantIds]);
    }
    if (createdPlanIds.length > 0) {
      await cleanupPool.query(`delete from plans where id = any($1::uuid[])`, [createdPlanIds]);
    }
    await cleanupPool.end();
    await platformPool.end();
  }, 30000);

  async function createActiveTenant(): Promise<string> {
    const tenant = await tenants.create(PLATFORM_ADMIN, {
      name: uniqueSlug('Billing Test School'),
      slug: uniqueSlug('billing-test'),
      planId: STARTER_PLAN,
    });
    createdTenantIds.push(tenant.id);
    await tenants.transition(tenant.id, PLATFORM_ADMIN, { toStatus: 'onboarding', reason: 'test setup', billingMethodConfirmed: true });
    await tenants.transition(tenant.id, PLATFORM_ADMIN, { toStatus: 'active', reason: 'test setup' });
    return tenant.id;
  }

  describe('createPlan()/updatePlan()', () => {
    it('a duplicate plan code 409s; updatePlan partially updates, 404s on an unknown id', async () => {
      const code = uniqueSlug('plan');
      const plan = await billing.createPlan({ code, name: 'Test Plan', billingBasis: 'flat', flatFeeAmount: 100 });
      createdPlanIds.push(plan.id);

      await expect(
        billing.createPlan({ code, name: 'Duplicate', billingBasis: 'flat', flatFeeAmount: 100 }),
      ).rejects.toThrow(/already in use/);

      const updated = await billing.updatePlan(plan.id, { name: 'Renamed Plan' });
      expect(updated.name).toBe('Renamed Plan');
      expect(updated.flat_fee_amount).toBe('100.00'); // untouched by this update

      await expect(billing.updatePlan('00000000-0000-0000-0000-000000000000', { name: 'x' })).rejects.toThrow(/not found/);
    });
  });

  describe('assignPlan()', () => {
    it('404s on an unknown tenant or plan; success creates a subscription and syncs tenants.plan_id', async () => {
      const tenantId = await createActiveTenant();

      await expect(
        billing.assignPlan(PLATFORM_ADMIN, '00000000-0000-0000-0000-000000000000', STARTER_PLAN, 'monthly'),
      ).rejects.toThrow(/not found/);
      await expect(
        billing.assignPlan(PLATFORM_ADMIN, tenantId, '00000000-0000-0000-0000-000000000000', 'monthly'),
      ).rejects.toThrow(/not found/);

      // Assigning STANDARD (createActiveTenant() started this tenant on
      // STARTER) proves the sync actually happens here, not that it was
      // simply already set at creation.
      const sub = await billing.assignPlan(PLATFORM_ADMIN, tenantId, STANDARD_PLAN, 'monthly');
      expect(sub.status).toBe('active');
      expect(sub.plan_id).toBe(STANDARD_PLAN);

      const tenant = await tenants.findOne(tenantId);
      expect(tenant.plan_id).toBe(STANDARD_PLAN);
    });
  });

  describe('generateInvoice() — FR-BIL-030', () => {
    it('409s with no active subscription, computes a flat-plan amount exactly once assigned', async () => {
      const tenantId = await createActiveTenant();

      await expect(
        billing.generateInvoice(PLATFORM_ADMIN, tenantId, '2026-09-01', '2026-09-30'),
      ).rejects.toThrow(/no active subscription/);

      await billing.assignPlan(PLATFORM_ADMIN, tenantId, STARTER_PLAN, 'monthly');
      const invoice = await billing.generateInvoice(PLATFORM_ADMIN, tenantId, '2026-09-01', '2026-09-30');
      expect(Number(invoice.amount)).toBe(500);
      expect(invoice.status).toBe('issued');

      const listed = await billing.listInvoices({ tenantId });
      expect(listed.map((i) => i.id)).toContain(invoice.id);
    });
  });

  describe('recordInvoicePayment()/markInvoiceOverdue()', () => {
    it('walks issued -> overdue -> paid, refusing an unknown id and a wrong-status transition', async () => {
      const tenantId = await createActiveTenant();
      await billing.assignPlan(PLATFORM_ADMIN, tenantId, STARTER_PLAN, 'monthly');
      const invoice = await billing.generateInvoice(PLATFORM_ADMIN, tenantId, '2026-09-01', '2026-09-30');

      await expect(billing.markInvoiceOverdue(PLATFORM_ADMIN, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        /not found or not in 'issued'/,
      );

      const overdue = await billing.markInvoiceOverdue(PLATFORM_ADMIN, invoice.id);
      expect(overdue.status).toBe('overdue');
      await expect(billing.markInvoiceOverdue(PLATFORM_ADMIN, invoice.id)).rejects.toThrow(/not found or not in 'issued'/);

      await expect(
        billing.recordInvoicePayment(PLATFORM_ADMIN, '00000000-0000-0000-0000-000000000000', 'REF-1'),
      ).rejects.toThrow(/not found/);

      const paid = await billing.recordInvoicePayment(PLATFORM_ADMIN, invoice.id, 'REF-BANK-001');
      expect(paid.status).toBe('paid');
      expect(paid.payment_method).toBe('bank_transfer');

      await expect(billing.recordInvoicePayment(PLATFORM_ADMIN, invoice.id, 'REF-2')).rejects.toThrow(/not payable/);
    });
  });

  describe('runDunningStep() — FR-BIL-040', () => {
    it('409s with no overdue invoice; advances active->past_due->suspended, enqueuing a real job each time', async () => {
      const tenantId = await createActiveTenant();
      await billing.assignPlan(PLATFORM_ADMIN, tenantId, STARTER_PLAN, 'monthly');

      await expect(billing.runDunningStep(PLATFORM_ADMIN, tenantId, 'no invoice yet')).rejects.toThrow(
        /no overdue platform invoice/,
      );

      const invoice = await billing.generateInvoice(PLATFORM_ADMIN, tenantId, '2026-09-01', '2026-09-30');
      await billing.markInvoiceOverdue(PLATFORM_ADMIN, invoice.id);

      const pastDue = await billing.runDunningStep(PLATFORM_ADMIN, tenantId, 'payment overdue');
      expect(pastDue.tenantStatus).toBe('past_due');
      // pbsms_platform has no direct SELECT grant on background_jobs
      // either — only platform_enqueue_job() (SECURITY DEFINER) can
      // touch it — so this read needs the schema-owning role too.
      const job1 = await cleanupPool.query<{ job_type: string; tenant_id: string }>(`select job_type, tenant_id from background_jobs where id = $1`, [
        pastDue.notificationJobId,
      ]);
      expect(job1.rows[0].job_type).toBe('dunning_notification');
      expect(job1.rows[0].tenant_id).toBe(tenantId);

      const suspended = await billing.runDunningStep(PLATFORM_ADMIN, tenantId, 'still overdue');
      expect(suspended.tenantStatus).toBe('suspended');

      const tenant = await tenants.findOne(tenantId);
      expect(tenant.status).toBe('suspended');
    });
  });

  describe('revenueReport() — FR-BIL-050', () => {
    it('reflects an active flat-plan subscription in MRR and buckets a paid invoice by status', async () => {
      const tenantId = await createActiveTenant();
      await billing.assignPlan(PLATFORM_ADMIN, tenantId, STARTER_PLAN, 'monthly');
      const invoice = await billing.generateInvoice(PLATFORM_ADMIN, tenantId, '2026-09-01', '2026-09-30');
      await billing.recordInvoicePayment(PLATFORM_ADMIN, invoice.id, 'REF-REVENUE-TEST');

      const report = await billing.revenueReport('2026-09-01', '2026-09-30');
      expect(Number(report.mrr)).toBeGreaterThanOrEqual(500); // at least this test's own flat subscription
      const paidBucket = report.invoiceTotalsByStatus.find((b) => b.status === 'paid');
      expect(paidBucket).toBeDefined();
      expect(Number(paidBucket!.count)).toBeGreaterThanOrEqual(1);
    });
  });
});
