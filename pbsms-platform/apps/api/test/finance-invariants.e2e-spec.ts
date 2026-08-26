/**
 * finance-invariants.e2e-spec.ts
 *
 * The "finance invariant suite" CLAUDE.md's EC-400 has named as a protected
 * test suite since 2026-08-24 without it actually existing — this file
 * closes that documentation-drift gap for real, ahead of EC-501 (the CI
 * job that will mechanically stop a future PR from quietly weakening or
 * deleting a case in this file).
 *
 * This is deliberately NOT a tenant-isolation test (that's
 * tenant-isolation.e2e-spec.ts's job, already covering every finance
 * table's cross-tenant RLS boundary). This suite asserts business/money
 * correctness invariants that only live in finance.service.ts's own logic
 * — RLS has nothing to say about whether a second approver is a genuinely
 * different person, or whether a reversal actually leaves its target row
 * untouched.
 *
 * Harness: FinanceService takes a Scope.REQUEST TenantDatabaseService, so
 * it can't be `new`'d directly against a plain Pool the way
 * tenant-lifecycle.e2e-spec.ts does for TenantsService (which takes a
 * plain Pool). Instead this reuses WorkerTenantConnection
 * (common/database/worker-tenant-connection.ts) — already built for the
 * exact same problem (worker.ts's job handlers need a real
 * TenantDatabaseService outside an HTTP request) — wrapped in
 * TenantContextStore.run() per call, the same idiom
 * tenant-lifecycle.e2e-spec.ts already uses for direct service
 * construction.
 *
 * Cleanup: every fee structure/invoice/payment/settlement batch this file
 * creates is tracked and deleted in `afterAll`, same
 * discipline as tenant-lifecycle.e2e-spec.ts's own `createdTenantIds`
 * cleanup (added there after 119 stray rows built up across sessions with
 * no teardown at all). This isn't just end-of-session tidiness here — a
 * first version of this file with no cleanup broke
 * tenant-isolation.e2e-spec.ts's own exact-row-count assertions for every
 * finance table WITHIN THE SAME `npm run test:e2e` run, since Jest runs
 * every *.e2e-spec.ts file against the same live database in one pass.
 *
 * Requires a running Postgres with every migration through
 * 0034_settlement_reconciliation.sql and seed_demo.sql already applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { FinanceService } from '../src/modules/finance/finance.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001';
const STUDENT_A = 'eeeeeeee-0000-0000-0000-000000000001'; // Ama Mensah
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise
const ACCOUNTANT = '99999999-0000-0000-0000-000000000004'; // accountant@sunrise — a genuinely different user, for maker-checker

function uniqueLevel(): string {
  return `EC501-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId, roles: [], isPlatformUser: false }, fn);
}

describe('Finance invariants (EC-501 protected suite)', () => {
  let pool: Pool;
  const feeStructureIds: string[] = [];
  const invoiceIds: string[] = [];
  const paymentIds: string[] = [];
  const settlementBatchIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asUser(HEADMASTER, async () => {
        await cleanup.query(
          `delete from reversals
           where (reversed_entity_type = 'payment' and reversed_entity_id = any($1::uuid[]))
              or (reversed_entity_type = 'invoice' and reversed_entity_id = any($2::uuid[]))
              or (reversed_entity_type = 'financial_assistance' and reversed_entity_id in (select id from financial_assistance where invoice_id = any($2::uuid[])))
              or (reversed_entity_type = 'fee_penalty_charge' and reversed_entity_id in (select id from fee_penalty_charges where invoice_id = any($2::uuid[])))`,
          [paymentIds, invoiceIds],
        );
        await cleanup.query(`delete from fee_penalty_charges where invoice_id = any($1::uuid[])`, [invoiceIds]);
        await cleanup.query(
          `delete from payment_allocations where invoice_id = any($1::uuid[]) or payment_id = any($2::uuid[])`,
          [invoiceIds, paymentIds],
        );
        await cleanup.query(`delete from financial_assistance where invoice_id = any($1::uuid[])`, [invoiceIds]);
        await cleanup.query(`delete from settlement_lines where settlement_batch_id = any($1::uuid[])`, [settlementBatchIds]);
        await cleanup.query(`delete from settlement_batches where id = any($1::uuid[])`, [settlementBatchIds]);
        await cleanup.query(`delete from payments where id = any($1::uuid[])`, [paymentIds]);
        await cleanup.query(`delete from invoice_items where invoice_id = any($1::uuid[])`, [invoiceIds]);
        await cleanup.query(`delete from invoices where id = any($1::uuid[])`, [invoiceIds]);
        await cleanup.query(`delete from fee_penalty_rules where fee_structure_id = any($1::uuid[])`, [feeStructureIds]);
        await cleanup.query(`delete from fee_instalments where fee_structure_id = any($1::uuid[])`, [feeStructureIds]);
        await cleanup.query(`delete from fee_structure_items where fee_structure_id = any($1::uuid[])`, [feeStructureIds]);
        await cleanup.query(`delete from fee_structures where id = any($1::uuid[])`, [feeStructureIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  /** One fresh connection + service pair per test, so a failure in one
   * test can never leave a checked-out client dangling for the next. */
  function harness(): { conn: WorkerTenantConnection; service: FinanceService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new FinanceService(conn) };
  }

  async function recordPayment(service: FinanceService, input: Record<string, unknown>) {
    const payment = await asUser(HEADMASTER, () => service.recordPayment(input as never));
    paymentIds.push(payment.id);
    return payment;
  }

  async function createSettlementBatch(service: FinanceService) {
    const batch = await asUser(HEADMASTER, () => service.createSettlementBatch({ source: 'bank_statement' } as never));
    settlementBatchIds.push(batch.id);
    return batch;
  }

  /** A fresh, active fee structure (one item, one matching instalment —
   * items-sum === instalments-sum, satisfying FR-FEE-020) and a posted
   * invoice generated against it for STUDENT_A. `level` is uniquified per
   * call so fee_structures' (tenant, academicYear, level) uniqueness never
   * collides across tests. */
  async function createPostedInvoice(service: FinanceService, totalAmount: number) {
    const level = uniqueLevel();
    const structure = await asUser(HEADMASTER, () =>
      service.createFeeStructure({ academicYearId: ACADEMIC_YEAR_A, level, name: `Invariant test ${level}` } as never),
    );
    feeStructureIds.push(structure.id);
    await asUser(HEADMASTER, () => service.addFeeStructureItem(structure.id, { name: 'Tuition', amount: totalAmount } as never));
    await asUser(HEADMASTER, () =>
      service.addInstalment(structure.id, { sequence: 1, dueDate: '2026-09-01', amount: totalAmount } as never),
    );
    await asUser(HEADMASTER, () => service.activateFeeStructure(structure.id));
    const invoice = await asUser(HEADMASTER, () =>
      service.generateInvoice({ studentId: STUDENT_A, feeStructureId: structure.id } as never),
    );
    invoiceIds.push(invoice.id);
    return invoice;
  }

  describe('financial assistance maker-checker (FR-FIN-010)', () => {
    it('rejects a second approval by the same user who did the first — application-code-enforced only, no DB backstop for this one', async () => {
      const { conn, service } = harness();
      try {
        const invoice = await createPostedInvoice(service, 1000);
        const assistance = await asUser(HEADMASTER, () =>
          service.requestAssistance({
            studentId: STUDENT_A,
            invoiceId: invoice.id,
            type: 'scholarship',
            amount: 600, // > 500 threshold, so this requires two distinct approvers
            reason: 'EC-501 invariant test',
          } as never),
        );
        await asUser(HEADMASTER, () => service.approveAssistance(assistance.id));

        await expect(asUser(HEADMASTER, () => service.secondApproveAssistance(assistance.id))).rejects.toThrow(
          /second approver must be different from the first/,
        );

        const approved = await asUser(ACCOUNTANT, () => service.secondApproveAssistance(assistance.id));
        expect(approved.status).toBe('approved');
        expect(approved.approved_by).toBe(ACCOUNTANT);
      } finally {
        conn.release();
      }
    });

    it("caps an approval against the invoice's CURRENT remaining balance, not what looked available at request time", async () => {
      const { conn, service } = harness();
      try {
        const invoice = await createPostedInvoice(service, 1000);

        // First request (700, > threshold) consumes 700 of the 1000 total.
        const first = await asUser(HEADMASTER, () =>
          service.requestAssistance({
            studentId: STUDENT_A,
            invoiceId: invoice.id,
            type: 'waiver',
            amount: 700,
            reason: 'first request',
          } as never),
        );
        await asUser(HEADMASTER, () => service.approveAssistance(first.id));
        await asUser(ACCOUNTANT, () => service.secondApproveAssistance(first.id));

        // Second request (400, <= threshold so single-approval) individually
        // looked fine when it was requested, but 700 + 400 > 1000.
        const second = await asUser(HEADMASTER, () =>
          service.requestAssistance({
            studentId: STUDENT_A,
            invoiceId: invoice.id,
            type: 'discount',
            amount: 400,
            reason: 'second request',
          } as never),
        );
        await expect(asUser(HEADMASTER, () => service.approveAssistance(second.id))).rejects.toThrow(
          /exceeds invoice .+'s remaining balance of 300/,
        );
      } finally {
        conn.release();
      }
    });
  });

  describe('reversals never mutate their target, and can only apply once (FR-FIN-020)', () => {
    it('leaves the reversed payment row byte-identical, and rejects a second reversal both at the service and DB level', async () => {
      const { conn, service } = harness();
      try {
        const invoice = await createPostedInvoice(service, 500);
        const payment = await recordPayment(service, { studentId: STUDENT_A, method: 'cash', amount: 500 });
        await asUser(HEADMASTER, () => service.allocate(payment.id, { invoiceId: invoice.id, amount: 500 } as never));

        const before = await asUser(HEADMASTER, () => service.findPayment(payment.id));
        await asUser(HEADMASTER, () => service.reversePayment(payment.id, { reason: 'refunded in error' } as never));
        const after = await asUser(HEADMASTER, () => service.findPayment(payment.id));
        expect(after).toEqual(before); // the payment row itself was never touched

        await expect(
          asUser(HEADMASTER, () => service.reversePayment(payment.id, { reason: 'trying again' } as never)),
        ).rejects.toThrow(/has already been reversed/);

        // The unique constraint on (tenant_id, reversed_entity_type,
        // reversed_entity_id) is the REAL "already reversed" guard — confirm
        // it rejects even a raw insert that bypasses the service's own
        // pre-check entirely.
        await expect(
          conn.query(
            `insert into reversals (tenant_id, reversed_entity_type, reversed_entity_id, amount, reason, created_by)
             values (current_tenant_id(), 'payment', $1, $2, $3, $4)`,
            [payment.id, payment.amount, 'forged duplicate reversal', HEADMASTER],
          ),
        ).rejects.toThrow(/duplicate key value violates unique constraint/);
      } finally {
        conn.release();
      }
    });
  });

  describe('cancelling an invoice touches only its status (FR-FIN-020)', () => {
    it('leaves total_amount and invoice_items unchanged, and always reports balance 0 afterward regardless of prior allocations', async () => {
      const { conn, service } = harness();
      try {
        const invoice = await createPostedInvoice(service, 1000);
        const payment = await recordPayment(service, { studentId: STUDENT_A, method: 'cash', amount: 400 });
        await asUser(HEADMASTER, () => service.allocate(payment.id, { invoiceId: invoice.id, amount: 400 } as never));

        const itemsBefore = await asUser(HEADMASTER, () => service.findInvoiceItems(invoice.id));

        await asUser(HEADMASTER, () => service.cancelInvoice(invoice.id, { reason: 'admission withdrawn' } as never));

        const cancelled = await asUser(HEADMASTER, () => service.findInvoice(invoice.id));
        expect(cancelled.status).toBe('cancelled');
        expect(cancelled.total_amount).toBe(invoice.total_amount);

        const itemsAfter = await asUser(HEADMASTER, () => service.findInvoiceItems(invoice.id));
        expect(itemsAfter).toEqual(itemsBefore);

        const balance = await asUser(HEADMASTER, () => service.findInvoiceBalance(invoice.id));
        expect(balance).toEqual({
          invoiceId: invoice.id,
          totalAmount: 1000,
          allocated: 0,
          assisted: 0,
          balance: 0,
          cancelled: true,
        });
      } finally {
        conn.release();
      }
    });
  });

  describe('allocation is capped on both the payment side and the invoice side', () => {
    it('rejects allocating more than remains unallocated on the payment itself', async () => {
      const { conn, service } = harness();
      try {
        const invoice = await createPostedInvoice(service, 1000);
        const payment = await recordPayment(service, { studentId: STUDENT_A, method: 'cash', amount: 500 });
        await asUser(HEADMASTER, () => service.allocate(payment.id, { invoiceId: invoice.id, amount: 500 } as never));

        await expect(
          asUser(HEADMASTER, () => service.allocate(payment.id, { invoiceId: invoice.id, amount: 0.01 } as never)),
        ).rejects.toThrow(/only 0 remains unallocated on payment/);
      } finally {
        conn.release();
      }
    });

    it("rejects allocating more than remains as the invoice's own balance", async () => {
      const { conn, service } = harness();
      try {
        const invoice = await createPostedInvoice(service, 500);
        const paymentA = await recordPayment(service, { studentId: STUDENT_A, method: 'cash', amount: 300 });
        const paymentB = await recordPayment(service, { studentId: STUDENT_A, method: 'cash', amount: 300 });
        await asUser(HEADMASTER, () => service.allocate(paymentA.id, { invoiceId: invoice.id, amount: 300 } as never));

        await expect(
          asUser(HEADMASTER, () => service.allocate(paymentB.id, { invoiceId: invoice.id, amount: 300 } as never)),
        ).rejects.toThrow(/only 200 remains as balance on invoice/);
      } finally {
        conn.release();
      }
    });

    /**
     * REAL DISCREPANCY FOUND WHILE SCOPING THIS SUITE, documented here
     * deliberately rather than fixed — finance is a protected zone, and
     * fixing a live money-correctness bug is a separate, bigger decision
     * than "add a test":
     *
     * findInvoiceBalance() excludes allocations tied to a reversed payment
     * (its query has an explicit `not exists (... reversals ...)` clause).
     * allocate()'s own invoice-side cap does NOT — its query is a plain
     * `sum(amount) from payment_allocations where invoice_id = $1`, no
     * reversal exclusion at all. So after a payment is reversed,
     * findInvoiceBalance() correctly reports the invoice's balance as
     * available again, but allocate() still counts the reversed payment's
     * old allocation as "used" and will reject a legitimate new allocation
     * that findInvoiceBalance() says should fit — the two balance
     * computations disagree. This test proves that disagreement is real
     * today; it is NOT asserting this is correct behavior.
     */
    it('DOCUMENTED BUG: after a reversal, allocate() still rejects an amount findInvoiceBalance() reports as free', async () => {
      const { conn, service } = harness();
      try {
        const invoice = await createPostedInvoice(service, 500);
        const payment1 = await recordPayment(service, { studentId: STUDENT_A, method: 'cash', amount: 500 });
        await asUser(HEADMASTER, () => service.allocate(payment1.id, { invoiceId: invoice.id, amount: 500 } as never));
        await asUser(HEADMASTER, () => service.reversePayment(payment1.id, { reason: 'bounced' } as never));

        const balanceAfterReversal = await asUser(HEADMASTER, () => service.findInvoiceBalance(invoice.id));
        expect(balanceAfterReversal.balance).toBe(500); // findInvoiceBalance correctly excludes the reversed allocation

        const payment2 = await recordPayment(service, { studentId: STUDENT_A, method: 'cash', amount: 100 });
        // findInvoiceBalance() says 500 is free; allocate() disagrees and
        // rejects even this much smaller amount, because its own
        // uncorrected sum still counts payment1's reversed allocation.
        await expect(
          asUser(HEADMASTER, () => service.allocate(payment2.id, { invoiceId: invoice.id, amount: 100 } as never)),
        ).rejects.toThrow(/only 0 remains as balance on invoice/);
      } finally {
        conn.release();
      }
    });
  });

  describe('settlement reconciliation (spec §8.8)', () => {
    it('rejects matching a payment to a second settlement line, at the service level and via the DB partial unique index', async () => {
      const { conn, service } = harness();
      try {
        const payment = await recordPayment(service, {
          studentId: STUDENT_A,
          method: 'bank_transfer',
          amount: 250,
          providerReference: 'EC501-REF',
        });
        const batch = await createSettlementBatch(service);
        const line1 = await asUser(HEADMASTER, () =>
          service.addSettlementLine(batch.id, { lineReference: 'EC501-REF', amount: 250 } as never),
        );
        const line2 = await asUser(HEADMASTER, () =>
          service.addSettlementLine(batch.id, { lineReference: 'EC501-REF-2', amount: 250 } as never),
        );

        const matched = await asUser(HEADMASTER, () => service.matchSettlementLine(line1.id, { paymentId: payment.id } as never));
        expect(matched.match_status).toBe('matched');

        await expect(
          asUser(HEADMASTER, () => service.matchSettlementLine(line2.id, { paymentId: payment.id } as never)),
        ).rejects.toThrow(/is already matched to settlement line/);

        // DB-level backstop, independent of the service's own pre-check —
        // uq_settlement_lines_matched_payment is a partial unique index.
        await expect(
          conn.query(
            `update settlement_lines set matched_payment_id = $1, match_status = 'matched' where id = $2`,
            [payment.id, line2.id],
          ),
        ).rejects.toThrow(/duplicate key value violates unique constraint/);
      } finally {
        conn.release();
      }
    });

    it('requires an explicit unmatch before a matched line can be re-matched to a different payment', async () => {
      const { conn, service } = harness();
      try {
        const paymentA = await recordPayment(service, { studentId: STUDENT_A, method: 'cash', amount: 300 });
        const paymentB = await recordPayment(service, { studentId: STUDENT_A, method: 'cash', amount: 300 });
        const batch = await createSettlementBatch(service);
        const line = await asUser(HEADMASTER, () => service.addSettlementLine(batch.id, { amount: 300 } as never));

        await asUser(HEADMASTER, () => service.matchSettlementLine(line.id, { paymentId: paymentA.id } as never));

        await expect(
          asUser(HEADMASTER, () => service.matchSettlementLine(line.id, { paymentId: paymentB.id } as never)),
        ).rejects.toThrow(/already matched — unmatch it first/);

        await asUser(HEADMASTER, () => service.unmatchSettlementLine(line.id));
        const rematched = await asUser(HEADMASTER, () => service.matchSettlementLine(line.id, { paymentId: paymentB.id } as never));
        expect(rematched.match_status).toBe('matched');
        expect(rematched.matched_payment_id).toBe(paymentB.id);
      } finally {
        conn.release();
      }
    });
  });

  describe('fee structure activation requires items-sum === instalments-sum (FR-FEE-020)', () => {
    it('rejects activation when the sums disagree, and succeeds once they match', async () => {
      const { conn, service } = harness();
      try {
        const level = uniqueLevel();
        const structure = await asUser(HEADMASTER, () =>
          service.createFeeStructure({ academicYearId: ACADEMIC_YEAR_A, level, name: `Sum check ${level}` } as never),
        );
        feeStructureIds.push(structure.id);
        await asUser(HEADMASTER, () => service.addFeeStructureItem(structure.id, { name: 'Tuition', amount: 1000 } as never));
        await asUser(HEADMASTER, () =>
          service.addInstalment(structure.id, { sequence: 1, dueDate: '2026-09-01', amount: 900 } as never),
        );

        await expect(asUser(HEADMASTER, () => service.activateFeeStructure(structure.id))).rejects.toThrow(
          /instalments sum to 900, items sum to 1000/,
        );

        await asUser(HEADMASTER, () =>
          service.addInstalment(structure.id, { sequence: 2, dueDate: '2026-10-01', amount: 100 } as never),
        );
        const activated = await asUser(HEADMASTER, () => service.activateFeeStructure(structure.id));
        expect(activated.status).toBe('active');
      } finally {
        conn.release();
      }
    });
  });

  describe('penalty charges truncate to the remaining cap room rather than being rejected (FR-FEE-040)', () => {
    it('charges exactly the remaining cap room when the raw computed amount would exceed it', async () => {
      const { conn, service } = harness();
      try {
        const invoice = await createPostedInvoice(service, 1000);
        // Force this specific invoice massively overdue, independent of
        // whenever this test actually runs — createPostedInvoice's own
        // instalment due date is in the near future, which wouldn't
        // satisfy applyPenalty()'s grace-period/overdue check.
        await conn.query(`update invoices set due_date = '2020-01-01' where id = $1`, [invoice.id]);

        const rule = await asUser(HEADMASTER, () =>
          service.createPenaltyRule(invoice.fee_structure_id, {
            name: 'Late fee',
            gracePeriodDays: 0,
            amountType: 'fixed',
            amount: 200, // raw amount would be 200
            capAmount: 150, // but the rule's cap is only 150
            frequency: 'daily',
          } as never),
        );

        const charge = await asUser(HEADMASTER, () => service.applyPenalty(invoice.id, { penaltyRuleId: rule.id } as never));
        expect(Number(charge.amount)).toBe(150); // truncated to the cap, not rejected outright
      } finally {
        conn.release();
      }
    });
  });
});
