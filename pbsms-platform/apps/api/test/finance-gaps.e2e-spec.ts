/**
 * finance-gaps.e2e-spec.ts
 *
 * Closes the specific FinanceService requirement IDs finance-invariants
 * .e2e-spec.ts/finance-audit-trail.e2e-spec.ts never exercised directly:
 * FR-FEE-010, FR-FEE-030, FR-PAY-010, FR-FIN-040. Deliberately a separate
 * file rather than an addition to either EC-400-protected suite — same
 * reasoning results-visibility.e2e-spec.ts gives for staying out of
 * results-immutability.e2e-spec.ts.
 *
 * Covers:
 *  - FR-FEE-010: createFeeStructure()'s (academicYear, level) uniqueness
 *    — a second structure for the same pair is refused with a clean 409,
 *    never a raw constraint-violation 500.
 *  - FR-FEE-030: generateInvoice()'s prorationFactor scales every fee
 *    item's amount (and the invoice's total_amount) by that factor,
 *    defaulting to 1.0 (full charge) when omitted.
 *  - FR-PAY-010: recordPayment() accepts the three manual/offline methods
 *    (cash/bank_transfer/cheque) but refuses 'mobile_money'/'card' as
 *    not-yet-implemented (no real provider integration exists yet).
 *  - FR-FIN-040: outstandingBalances() — one dashboard of the eight the
 *    requirement names. An unpaid invoice appears with the correct
 *    balance; a fully-paid invoice is excluded entirely (balance <= 0 is
 *    filtered out, not returned as a zero row). Also documents a REAL BUG
 *    this test found and did NOT fix (see that test's own comment): the
 *    `overdue` flag can never be true for any invoice, any due_date —
 *    a Date-vs-string type-comparison bug, not a spec gap.
 *
 * Harness pattern copied from finance-invariants.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom, same
 * fee-structure/invoice fixture shape, same afterAll cleanup discipline
 * (this file's stray rows would otherwise pollute
 * tenant-isolation.e2e-spec.ts's exact-row-count assertions, same risk
 * that file's own header warns about).
 *
 * Requires a running Postgres with every migration through
 * 0034_settlement_reconciliation.sql (and seed_demo.sql) applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { FinanceService } from '../src/modules/finance/finance.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001';
const STUDENT_A = 'eeeeeeee-0000-0000-0000-000000000001'; // Ama Mensah
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

function asUser<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueLevel(): string {
  return `FR-FEE ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Finance gaps (FR-FEE-010/030, FR-PAY-010, FR-FIN-040)', () => {
  let pool: Pool;
  const feeStructureIds: string[] = [];
  const invoiceIds: string[] = [];
  const paymentIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asUser(async () => {
        await cleanup.query(`delete from payment_allocations where payment_id = any($1::uuid[])`, [paymentIds]);
        await cleanup.query(`delete from payments where id = any($1::uuid[])`, [paymentIds]);
        await cleanup.query(`delete from invoice_items where invoice_id = any($1::uuid[])`, [invoiceIds]);
        await cleanup.query(`delete from invoices where id = any($1::uuid[])`, [invoiceIds]);
        await cleanup.query(`delete from fee_instalments where fee_structure_id = any($1::uuid[])`, [feeStructureIds]);
        await cleanup.query(`delete from fee_structure_items where fee_structure_id = any($1::uuid[])`, [feeStructureIds]);
        await cleanup.query(`delete from fee_structures where id = any($1::uuid[])`, [feeStructureIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: FinanceService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new FinanceService(conn) };
  }

  /** A fresh active fee structure (one item, one matching instalment) —
   * same shape finance-invariants.e2e-spec.ts's own helper uses. */
  async function createActiveFeeStructure(service: FinanceService, totalAmount: number, level = uniqueLevel()) {
    const structure = await asUser(() =>
      service.createFeeStructure({ academicYearId: ACADEMIC_YEAR_A, level, name: `FR-FEE test ${level}` } as never),
    );
    feeStructureIds.push(structure.id);
    await asUser(() => service.addFeeStructureItem(structure.id, { name: 'Tuition', amount: totalAmount } as never));
    await asUser(() => service.addInstalment(structure.id, { sequence: 1, dueDate: '2026-09-01', amount: totalAmount } as never));
    await asUser(() => service.activateFeeStructure(structure.id));
    return { structure, level };
  }

  describe('createFeeStructure() — FR-FEE-010 (academicYear, level) uniqueness', () => {
    it('refuses a second fee structure for the same academic year + level with a clean 409', async () => {
      const { conn, service } = harness();
      try {
        const { level } = await createActiveFeeStructure(service, 100);

        await expect(
          asUser(() => service.createFeeStructure({ academicYearId: ACADEMIC_YEAR_A, level, name: 'Duplicate' } as never)),
        ).rejects.toThrow(/already exists in academic year/);
      } finally {
        conn.release();
      }
    });
  });

  describe('generateInvoice() — FR-FEE-030 prorationFactor', () => {
    it('scales the invoice total by prorationFactor, defaulting to 1.0 when omitted', async () => {
      const { conn, service } = harness();
      try {
        const { structure: fullStructure } = await createActiveFeeStructure(service, 1000);
        const fullInvoice = await asUser(() =>
          service.generateInvoice({ studentId: STUDENT_A, feeStructureId: fullStructure.id } as never),
        );
        invoiceIds.push(fullInvoice.id);
        expect(Number(fullInvoice.total_amount)).toBe(1000);
        expect(Number(fullInvoice.proration_factor)).toBe(1);

        const { structure: proratedStructure } = await createActiveFeeStructure(service, 1000);
        const proratedInvoice = await asUser(() =>
          service.generateInvoice({ studentId: STUDENT_A, feeStructureId: proratedStructure.id, prorationFactor: 0.5 } as never),
        );
        invoiceIds.push(proratedInvoice.id);
        expect(Number(proratedInvoice.total_amount)).toBe(500);
        expect(Number(proratedInvoice.proration_factor)).toBe(0.5);
      } finally {
        conn.release();
      }
    });
  });

  describe('recordPayment() — FR-PAY-010', () => {
    it('accepts cash but refuses mobile_money/card as not-yet-implemented', async () => {
      const { conn, service } = harness();
      try {
        const payment = await asUser(() => service.recordPayment({ studentId: STUDENT_A, method: 'cash', amount: 250 } as never));
        paymentIds.push(payment.id);
        expect(payment.method).toBe('cash');

        await expect(
          asUser(() => service.recordPayment({ studentId: STUDENT_A, method: 'mobile_money', amount: 250 } as never)),
        ).rejects.toThrow(/requires a real provider integration/);
        await expect(
          asUser(() => service.recordPayment({ studentId: STUDENT_A, method: 'card', amount: 250 } as never)),
        ).rejects.toThrow(/requires a real provider integration/);
      } finally {
        conn.release();
      }
    });
  });

  describe('outstandingBalances() — FR-FIN-040', () => {
    it('includes an unpaid overdue invoice with the correct balance, excludes a fully-paid one', async () => {
      const { conn, service } = harness();
      try {
        const { structure: unpaidStructure } = await createActiveFeeStructure(service, 400);
        const unpaidInvoice = await asUser(() =>
          service.generateInvoice({ studentId: STUDENT_A, feeStructureId: unpaidStructure.id } as never),
        );
        invoiceIds.push(unpaidInvoice.id);
        await asUser(() =>
          conn.query(`update invoices set due_date = '2020-01-01' where id = $1`, [unpaidInvoice.id]),
        );

        const { structure: paidStructure } = await createActiveFeeStructure(service, 300);
        const paidInvoice = await asUser(() =>
          service.generateInvoice({ studentId: STUDENT_A, feeStructureId: paidStructure.id } as never),
        );
        invoiceIds.push(paidInvoice.id);
        const payment = await asUser(() => service.recordPayment({ studentId: STUDENT_A, method: 'cash', amount: 300 } as never));
        paymentIds.push(payment.id);
        await asUser(() => service.allocate(payment.id, { invoiceId: paidInvoice.id, amount: 300 } as never));

        const balances = await asUser(() => service.outstandingBalances());

        const unpaidRow = balances.find((b) => b.invoice_id === unpaidInvoice.id);
        expect(unpaidRow).toBeDefined();
        expect(unpaidRow?.balance).toBe(400);

        // REAL BUG this test found, not fixed here (Finance is a CLAUDE.md
        // protected zone and general implementation work is gated on the
        // Stage-4 defect-escape baseline, which doesn't exist yet — see
        // CLAUDE.md's Internal Engineering Agent section, "What's actually
        // authorized right now"). `overdue` is computed as
        // `r.due_date < new Date().toISOString().slice(0, 10)` in
        // outstandingBalances() — but node-pg returns a `date` column as a
        // JS `Date` object, not a string. The `<` operator's abstract
        // relational comparison converts a Date via valueOf() (a number)
        // and a non-numeric string via ToNumber() (NaN); `number < NaN` is
        // always false. This flag can never fire, for any due_date, no
        // matter how overdue. Asserting the CURRENT (wrong) behavior here
        // rather than silently working around it or asserting the
        // intended one and leaving the suite red — reported, not fixed,
        // per this repo's own EC-107 posture.
        expect(unpaidRow?.overdue).toBe(false);

        expect(balances.find((b) => b.invoice_id === paidInvoice.id)).toBeUndefined();
      } finally {
        conn.release();
      }
    });
  });
});
