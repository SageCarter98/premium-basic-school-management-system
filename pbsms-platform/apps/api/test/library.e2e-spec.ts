/**
 * library.e2e-spec.ts
 *
 * Chapter 28 (Library), FR-OPS-010 — genuinely untested before this file
 * (no existing suite constructs LibraryService).
 *
 * Covers:
 *  - createMember()'s "exactly one of studentId/staffUserId" rule
 *    (mirrored at the app layer for a friendly error; the DB CHECK is the
 *    real backstop).
 *  - Circulation: issueLoan() decrements available_copies and refuses
 *    once none remain; returnLoan() increments them back and computes a
 *    correct overdue fine (or none, for an on-time return); renewLoan()
 *    extends the due date and increments renewal_count, but refuses once
 *    a loan is already overdue; payFine() refuses when there's nothing
 *    owed or it's already settled.
 *
 * Harness pattern copied from results-immutability.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom, same per-file
 * fixture tracking and afterAll cleanup.
 *
 * Requires a running Postgres with every migration through
 * 0012_library.sql (and everything seed_demo.sql needs) already applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { LibraryService } from '../src/modules/library/library.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const STUDENT_A = 'eeeeeeee-0000-0000-0000-000000000001'; // Ama Mensah
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

function asUser<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Library (Chapter 28 FR-OPS-010)', () => {
  let pool: Pool;
  const itemIds: string[] = [];
  const memberIds: string[] = [];
  const loanIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asUser(async () => {
        await cleanup.query(`delete from library_loans where id = any($1::uuid[])`, [loanIds]);
        await cleanup.query(`delete from library_members where id = any($1::uuid[])`, [memberIds]);
        await cleanup.query(`delete from library_items where id = any($1::uuid[])`, [itemIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: LibraryService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new LibraryService(conn) };
  }

  async function createItem(service: LibraryService, totalCopies: number) {
    const item = await asUser(() =>
      service.createItem({ title: uniqueTitle('Fixture Book'), totalCopies } as never),
    );
    itemIds.push(item.id);
    return item;
  }

  async function createStudentMember(service: LibraryService) {
    const member = await asUser(() => service.createMember({ studentId: STUDENT_A } as never));
    memberIds.push(member.id);
    return member;
  }

  describe('createMember() — exactly one of studentId/staffUserId', () => {
    it('rejects both and neither, accepts exactly one', async () => {
      const { conn, service } = harness();
      try {
        await expect(asUser(() => service.createMember({} as never))).rejects.toThrow(
          /requires exactly one of studentId or staffUserId/,
        );
        await expect(
          asUser(() => service.createMember({ studentId: STUDENT_A, staffUserId: HEADMASTER } as never)),
        ).rejects.toThrow(/requires exactly one of studentId or staffUserId/);

        const member = await createStudentMember(service);
        expect(member.student_id).toBe(STUDENT_A);
        expect(member.staff_user_id).toBeNull();
      } finally {
        conn.release();
      }
    });
  });

  describe('issueLoan()/returnLoan() — circulation and fines', () => {
    it('decrements available_copies on issue, refuses once none remain, restores on return', async () => {
      const { conn, service } = harness();
      try {
        const item = await createItem(service, 1);
        const member = await createStudentMember(service);
        const dueDate = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);

        const loan = await asUser(() => service.issueLoan({ itemId: item.id, memberId: member.id, dueDate } as never));
        loanIds.push(loan.id);

        const afterIssue = await asUser(() => service.findItem(item.id));
        expect(afterIssue.available_copies).toBe(0);

        const secondMember = await createStudentMember(service);
        await expect(
          asUser(() => service.issueLoan({ itemId: item.id, memberId: secondMember.id, dueDate } as never)),
        ).rejects.toThrow(/no available copies/);

        const returned = await asUser(() => service.returnLoan(loan.id));
        expect(returned.status).toBe('returned');
        expect(Number(returned.fine_amount)).toBe(0); // returned on time

        const afterReturn = await asUser(() => service.findItem(item.id));
        expect(afterReturn.available_copies).toBe(1);
      } finally {
        conn.release();
      }
    });

    it('computes a nonzero fine for an overdue return, and refuses a second return of the same loan', async () => {
      const { conn, service } = harness();
      try {
        const item = await createItem(service, 1);
        const member = await createStudentMember(service);
        const pastDueDate = new Date(Date.now() - 5 * 86400_000).toISOString().slice(0, 10);

        const loan = await asUser(() =>
          service.issueLoan({ itemId: item.id, memberId: member.id, dueDate: pastDueDate } as never),
        );
        loanIds.push(loan.id);

        const returned = await asUser(() => service.returnLoan(loan.id));
        expect(Number(returned.fine_amount)).toBeGreaterThan(0);

        await expect(asUser(() => service.returnLoan(loan.id))).rejects.toThrow(/not 'on_loan'/);
      } finally {
        conn.release();
      }
    });
  });

  describe('renewLoan() — FR-OPS-010', () => {
    it('extends the due date and increments renewal_count, but refuses once already overdue', async () => {
      const { conn, service } = harness();
      try {
        const item = await createItem(service, 1);
        const member = await createStudentMember(service);
        const dueDate = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);

        const loan = await asUser(() => service.issueLoan({ itemId: item.id, memberId: member.id, dueDate } as never));
        loanIds.push(loan.id);

        const renewed = await asUser(() => service.renewLoan(loan.id));
        expect(renewed.renewal_count).toBe(1);
        expect(new Date(renewed.due_date).getTime()).toBeGreaterThan(new Date(dueDate).getTime());

        const overdueItem = await createItem(service, 1);
        const overdueMember = await createStudentMember(service);
        const pastDueDate = new Date(Date.now() - 1 * 86400_000).toISOString().slice(0, 10);
        const overdueLoan = await asUser(() =>
          service.issueLoan({ itemId: overdueItem.id, memberId: overdueMember.id, dueDate: pastDueDate } as never),
        );
        loanIds.push(overdueLoan.id);

        await expect(asUser(() => service.renewLoan(overdueLoan.id))).rejects.toThrow(/already overdue/);
      } finally {
        conn.release();
      }
    });
  });

  describe('payFine() — FR-OPS-010', () => {
    it('refuses when there is no outstanding fine, succeeds once one exists, refuses to pay it twice', async () => {
      const { conn, service } = harness();
      try {
        const item = await createItem(service, 1);
        const member = await createStudentMember(service);
        const pastDueDate = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
        const loan = await asUser(() =>
          service.issueLoan({ itemId: item.id, memberId: member.id, dueDate: pastDueDate } as never),
        );
        loanIds.push(loan.id);

        await expect(asUser(() => service.payFine(loan.id))).rejects.toThrow(/has no outstanding fine/);

        const returned = await asUser(() => service.returnLoan(loan.id));
        expect(Number(returned.fine_amount)).toBeGreaterThan(0);

        const paid = await asUser(() => service.payFine(loan.id));
        expect(paid.fine_paid).toBe(true);

        await expect(asUser(() => service.payFine(loan.id))).rejects.toThrow(/already paid/);
      } finally {
        conn.release();
      }
    });
  });
});
