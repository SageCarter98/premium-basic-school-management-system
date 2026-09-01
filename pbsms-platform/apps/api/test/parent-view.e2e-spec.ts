/**
 * parent-view.e2e-spec.ts
 *
 * FR-STU-060 (Chapter 16.2/§6.3/§8.6-8.7, Stage 6 Parent View) —
 * "guardians see only linked learners, and only published or explicitly
 * authorized academic, attendance, financial and communication records."
 * ParentViewService had zero test coverage before this file.
 *
 * Covers:
 *  - assertLinked() (exercised via getReportCard()/getInvoices()): a
 *    guardian with no link to a student is refused; a link that exists
 *    but lacks has_report_access/has_finance_access is refused on the
 *    matching method, independently of the other flag.
 *  - getHome(): per linked child, latestResult is only populated when
 *    has_report_access is true, totalBalance only when has_finance_access
 *    is true — attendance is always included regardless (no gating flag
 *    exists for it).
 *  - getReportCard(): 404s when no published result exists yet; a
 *    specific resultId belonging to a DIFFERENT student is refused, never
 *    silently returned.
 *  - getInvoices(): returns invoice+balance pairs once finance access is
 *    granted.
 *
 * The guardian actor is set up exactly as tenant.middleware.ts's
 * PARENT_PATH_PREFIX branch does: `userId` is the fixed system-actor id
 * (worker.ts's SYSTEM_ACTOR_ID — a guardian has no `users` row and no FK
 * target), `guardianId` carries the real actor — see tenant-context.ts's
 * own doc comment for why.
 *
 * Harness pattern copied from results-immutability.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom, same per-file
 * fixture tracking and afterAll cleanup.
 *
 * Requires a running Postgres with every migration through
 * 0031_guardian_access.sql (and seed_demo.sql) applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { ParentViewService } from '../src/modules/parent-view/parent-view.service';
import { ResultsService } from '../src/modules/results/results.service';
import { TeacherAssignmentsService } from '../src/modules/teacher-assignments/teacher-assignments.service';
import { FinanceService } from '../src/modules/finance/finance.service';
import { NaccaService } from '../src/modules/nacca/nacca.service';
import { GuardiansService } from '../src/modules/guardians/guardians.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001';
const SUBJECT_A = '55555555-0000-0000-0000-000000000001'; // Mathematics
const GRADING_POLICY_A = 'a0000000-0000-0000-0000-000000000001';
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000001'; // worker.ts's SYSTEM_ACTOR_ID

function asHeadmaster<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}
function asGuardian<T>(guardianId: string, fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: SYSTEM_ACTOR_ID, roles: [], isPlatformUser: false, guardianId }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Parent View (FR-STU-060)', () => {
  let pool: Pool;
  const studentIds: string[] = [];
  const classIds: string[] = [];
  const resultIds: string[] = [];
  const guardianIds: string[] = [];
  const linkIds: string[] = [];
  const attendanceIds: string[] = [];
  const feeStructureIds: string[] = [];
  const invoiceIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asHeadmaster(async () => {
        await cleanup.query(`delete from invoice_items where invoice_id = any($1::uuid[])`, [invoiceIds]);
        await cleanup.query(`delete from invoices where id = any($1::uuid[])`, [invoiceIds]);
        await cleanup.query(`delete from fee_instalments where fee_structure_id = any($1::uuid[])`, [feeStructureIds]);
        await cleanup.query(`delete from fee_structure_items where fee_structure_id = any($1::uuid[])`, [feeStructureIds]);
        await cleanup.query(`delete from fee_structures where id = any($1::uuid[])`, [feeStructureIds]);
        await cleanup.query(`delete from attendance_records where id = any($1::uuid[])`, [attendanceIds]);
        await cleanup.query(`delete from student_guardians where id = any($1::uuid[])`, [linkIds]);
        await cleanup.query(`delete from guardians where id = any($1::uuid[])`, [guardianIds]);
        await cleanup.query(`delete from student_result_items where student_result_id = any($1::uuid[])`, [resultIds]);
        await cleanup.query(`delete from student_results where id = any($1::uuid[])`, [resultIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: ParentViewService } {
    const conn = new WorkerTenantConnection(pool);
    const results = new ResultsService(conn, new TeacherAssignmentsService(conn));
    const finance = new FinanceService(conn);
    const nacca = new NaccaService(conn);
    return { conn, service: new ParentViewService(conn, results, finance, nacca) };
  }

  async function createStudent(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-STU-060', 'Fixture', $3, $3) returning id`,
        [SCHOOL_A, uniqueName('ADM'), HEADMASTER],
      ),
    );
    studentIds.push(rows[0].id);
    return rows[0].id;
  }

  async function createClass(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [ACADEMIC_YEAR_A, uniqueName('FR-STU-060 Class'), 'JHS 2', HEADMASTER],
      ),
    );
    classIds.push(rows[0].id);
    return rows[0].id;
  }

  async function createLinkedGuardian(
    conn: WorkerTenantConnection,
    studentId: string,
    flags: { hasReportAccess?: boolean; hasFinanceAccess?: boolean } = {},
  ): Promise<string> {
    const guardians = new GuardiansService(conn);
    const guardian = await asHeadmaster(() => guardians.create({ fullName: uniqueName('Fixture Guardian') }));
    guardianIds.push(guardian.id);
    const link = await asHeadmaster(() =>
      guardians.linkToStudent(studentId, {
        guardianId: guardian.id,
        isPrimaryContact: true,
        hasReportAccess: flags.hasReportAccess ?? false,
        hasFinanceAccess: flags.hasFinanceAccess ?? false,
      }),
    );
    linkIds.push(link.id);
    return guardian.id;
  }

  async function publishResult(conn: WorkerTenantConnection, studentId: string, classId: string) {
    const results = new ResultsService(conn, new TeacherAssignmentsService(conn));
    const draft = await asHeadmaster(() => results.create({ studentId, classId, academicYearId: ACADEMIC_YEAR_A } as never));
    resultIds.push(draft.id);
    await asHeadmaster(() =>
      conn.query(
        `insert into student_result_items
           (tenant_id, student_result_id, subject_id, subject_name, grading_policy_id, percentage, grade, is_pass)
         values (current_tenant_id(), $1, $2, 'Mathematics', $3, '75.00', 'B', true)`,
        [draft.id, SUBJECT_A, GRADING_POLICY_A],
      ),
    );
    await asHeadmaster(() =>
      conn.query(`update student_results set average_percentage = '75.00', subjects_failed_count = 0, overall_pass = true where id = $1`, [draft.id]),
    );
    await asHeadmaster(() => results.submit(draft.id));
    await asHeadmaster(() => results.review(draft.id));
    await asHeadmaster(() => results.approve(draft.id));
    return asHeadmaster(() => results.publish(draft.id));
  }

  describe('getHome()', () => {
    it('populates latestResult only with report access, totalBalance only with finance access, attendance always', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        const guardianId = await createLinkedGuardian(conn, studentId, { hasReportAccess: true, hasFinanceAccess: false });
        const classId = await createClass(conn);
        await publishResult(conn, studentId, classId);

        const attRows = await asHeadmaster(() =>
          conn.query<{ id: string }>(
            `insert into attendance_records (tenant_id, student_id, class_id, attendance_date, status, client_id, created_by, updated_by)
             values (current_tenant_id(), $1, $2, '2026-08-20', 'present', $3, $4, $4) returning id`,
            [studentId, classId, uniqueName('client'), HEADMASTER],
          ),
        );
        attendanceIds.push(attRows[0].id);

        const home = await asGuardian(guardianId, () => service.getHome());
        expect(home).toHaveLength(1);
        expect(home[0].latestResult).not.toBeNull();
        expect(home[0].totalBalance).toBeNull();
        expect(home[0].attendance.total).toBe(1);
        expect(home[0].attendance.present).toBe(1);
      } finally {
        conn.release();
      }
    });
  });

  describe('getReportCard()', () => {
    it('refuses an unlinked student, refuses without report access, 404s with no published result, refuses a mismatched resultId', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        const otherStudentId = await createStudent(conn);
        const classId = await createClass(conn);

        const noAccessGuardianId = await createLinkedGuardian(conn, studentId, { hasReportAccess: false });
        await expect(asGuardian(noAccessGuardianId, () => service.getReportCard(studentId))).rejects.toThrow(
          /does not include report access/,
        );

        const unlinkedGuardians = new GuardiansService(conn);
        const unlinkedGuardian = await asHeadmaster(() => unlinkedGuardians.create({ fullName: 'Unlinked Guardian' }));
        guardianIds.push(unlinkedGuardian.id);
        await expect(asGuardian(unlinkedGuardian.id, () => service.getReportCard(studentId))).rejects.toThrow(
          /not associated with student/,
        );

        const reportAccessGuardianId = await createLinkedGuardian(conn, studentId, { hasReportAccess: true });
        await expect(asGuardian(reportAccessGuardianId, () => service.getReportCard(studentId))).rejects.toThrow(
          /No published result yet/,
        );

        const published = await publishResult(conn, studentId, classId);
        const fetched = await asGuardian(reportAccessGuardianId, () => service.getReportCard(studentId));
        expect(fetched.result.id).toBe(published.id);

        const otherResult = await publishResult(conn, otherStudentId, classId);
        await expect(
          asGuardian(reportAccessGuardianId, () => service.getReportCard(studentId, otherResult.id)),
        ).rejects.toThrow(/does not belong to this student/);
      } finally {
        conn.release();
      }
    });
  });

  describe('getInvoices()', () => {
    it('refuses without finance access, returns invoice+balance pairs once granted', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        const noAccessGuardianId = await createLinkedGuardian(conn, studentId, { hasFinanceAccess: false });
        await expect(asGuardian(noAccessGuardianId, () => service.getInvoices(studentId))).rejects.toThrow(
          /does not include finance access/,
        );

        const finance = new FinanceService(conn);
        const level = uniqueName('FR-STU-060-Level');
        const structure = await asHeadmaster(() =>
          finance.createFeeStructure({ academicYearId: ACADEMIC_YEAR_A, level, name: `Parent view test ${level}` } as never),
        );
        feeStructureIds.push(structure.id);
        await asHeadmaster(() => finance.addFeeStructureItem(structure.id, { name: 'Tuition', amount: 200 } as never));
        await asHeadmaster(() => finance.addInstalment(structure.id, { sequence: 1, dueDate: '2026-09-01', amount: 200 } as never));
        await asHeadmaster(() => finance.activateFeeStructure(structure.id));
        const invoice = await asHeadmaster(() => finance.generateInvoice({ studentId, feeStructureId: structure.id } as never));
        invoiceIds.push(invoice.id);

        const financeAccessGuardianId = await createLinkedGuardian(conn, studentId, { hasFinanceAccess: true });
        const invoices = await asGuardian(financeAccessGuardianId, () => service.getInvoices(studentId));
        expect(invoices).toHaveLength(1);
        expect(invoices[0].balance.balance).toBe(200);
      } finally {
        conn.release();
      }
    });
  });
});
