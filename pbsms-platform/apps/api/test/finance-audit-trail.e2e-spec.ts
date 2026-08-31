/**
 * finance-audit-trail.e2e-spec.ts
 *
 * Chapter 24 FR-PAY-050: "Every posting records actor, source, time,
 * amount, currency, related student, method and reference; multi-record
 * operations use database transactions and idempotency protections."
 *
 * Scoped deliberately narrower than the requirement's full text — the
 * other two clauses are NOT tested here, for reasons worth stating rather
 * than silently skipping:
 *
 *  - "multi-record operations use database transactions": already
 *    exercised, extensively, by finance-invariants.e2e-spec.ts's
 *    "allocation is capped on both the payment side and the invoice side"
 *    block (an EC-400 protected suite this file doesn't touch) — that
 *    block's two DOCUMENTED BUG cases prove allocate()'s locking/capping
 *    behavior in detail. Duplicating that here would test the same code
 *    path twice for no new signal.
 *
 *  - "idempotency protections": genuinely not built. finance.service.ts's
 *    own header names "no real Paystack/Hubtel/MTN MoMo/Telecel
 *    integration" as a deliberate scope cut, and 0008_finance.sql's
 *    `payments.status` column comment says 'pending'/'verified'/'failed'
 *    are unused placeholders "so a future async provider flow (FR-PAY-020)
 *    doesn't need a column rename" — recordPayment() has no idempotency
 *    key or duplicate-submission guard today. Writing a test against this
 *    would be testing something that doesn't exist, the same mistake
 *    EC-107's own report already flagged for FR-FIN-030 elsewhere.
 *
 * Chapter 24 FR-PAY-040 ("invoice generation, payment capture,
 * verification, allocation, reversal approval, assistance approval,
 * reconciliation, period close and report export are distinguishable,
 * separately permissioned actions") is not covered by ANY test in this
 * file either, and deliberately not attempted: that's an HTTP/NestJS-guard
 * concern (finance.controller.ts's `@Roles(...RECORD_ROLES/APPROVE_ROLES/
 * READ_ROLES)` decorators), and every e2e suite in this codebase —
 * including all four EC-400 protected ones — tests at the service layer,
 * constructing services directly and never routing through a controller
 * or its guards. Testing FR-PAY-040 for real would mean introducing this
 * codebase's first HTTP-level e2e test, a materially different and larger
 * decision than "add a missing test case" — flagged for the Engineering
 * Lead rather than built unilaterally here.
 *
 * Harness copied from finance-invariants.e2e-spec.ts (see that file's
 * header for the full rationale) — same WorkerTenantConnection +
 * TenantContextStore.run() idiom, same per-file fixture tracking and
 * afterAll cleanup.
 *
 * Requires a running Postgres with every migration through
 * 0008_finance.sql and seed_demo.sql already applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { FinanceService } from '../src/modules/finance/finance.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const STUDENT_A = 'eeeeeeee-0000-0000-0000-000000000001'; // Ama Mensah
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId, roles: [], isPlatformUser: false }, fn);
}

describe('Finance audit trail (Chapter 24 FR-PAY-050, posting field completeness)', () => {
  let pool: Pool;
  const paymentIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asUser(HEADMASTER, () => cleanup.query(`delete from payments where id = any($1::uuid[])`, [paymentIds]));
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: FinanceService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new FinanceService(conn) };
  }

  it('records actor, time, amount, currency, student, method and reference on a manual-method payment', async () => {
    const { conn, service } = harness();
    try {
      const before = new Date();
      const payment = await asUser(HEADMASTER, () =>
        service.recordPayment({
          studentId: STUDENT_A,
          method: 'bank_transfer',
          providerReference: 'FR-PAY-050-REF',
          amount: 425.5,
          currency: 'GHS',
        } as never),
      );
      paymentIds.push(payment.id);

      // actor
      expect(payment.received_by).toBe(HEADMASTER);
      // related student
      expect(payment.student_id).toBe(STUDENT_A);
      // method (also doubles as "source" — the only source this pass has,
      // since no real payment-provider integration exists yet)
      expect(payment.method).toBe('bank_transfer');
      // reference
      expect(payment.provider_reference).toBe('FR-PAY-050-REF');
      // amount and currency
      expect(payment.amount).toBe('425.50');
      expect(payment.currency).toBe('GHS');
      // time — received_at is DB-generated (now()), not caller-supplied;
      // assert it's a real, recent timestamp rather than null/default-epoch.
      const receivedAt = new Date(payment.received_at);
      expect(receivedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(receivedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    } finally {
      conn.release();
    }
  });

  it('defaults currency to GHS and leaves reference null when the caller omits both', async () => {
    const { conn, service } = harness();
    try {
      const payment = await asUser(HEADMASTER, () =>
        service.recordPayment({ studentId: STUDENT_A, method: 'cash', amount: 50 } as never),
      );
      paymentIds.push(payment.id);

      expect(payment.currency).toBe('GHS');
      expect(payment.provider_reference).toBeNull();
    } finally {
      conn.release();
    }
  });
});
