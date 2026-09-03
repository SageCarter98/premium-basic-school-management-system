/**
 * documents.e2e-spec.ts
 *
 * Chapter 22.1 (Document Engine), FR-DOC-010/020/030 — genuinely
 * untested before this file. Covers each generate*() method's approval
 * gate (draft result / non-admitted applicant / undecided or unapplied
 * promotion / a real payment), revoke()'s single-use guard, and
 * verify()'s no-tenant-context public path (valid/invalid/revoked, plus
 * the 20-per-15min rate limit).
 *
 * Fixtures use direct SQL insert / the owning service (FinanceService,
 * ResultsService) rather than duplicating those state machines —
 * documents.service.ts only ever reads these tables, never writes them.
 * Harness copied from results-immutability.e2e-spec.ts.
 *
 * Requires a running Postgres with every migration through
 * 0037_document_verify_rate_limit.sql (and seed_demo.sql) applied.
 */

import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { PG_POOL } from '../src/common/database/tenant-database.service';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { NaccaService } from '../src/modules/nacca/nacca.service';
import { ResultsService } from '../src/modules/results/results.service';
import { TeacherAssignmentsService } from '../src/modules/teacher-assignments/teacher-assignments.service';
import { FinanceService } from '../src/modules/finance/finance.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001';
const SUBJECT_A = '55555555-0000-0000-0000-000000000001'; // Mathematics
const GRADING_POLICY_A = 'a0000000-0000-0000-0000-000000000001';
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

function asHeadmaster<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

describe('Documents (Chapter 22.1 FR-DOC-010/020/030)', () => {
  let pool: Pool;
  const studentIds: string[] = [];
  const classIds: string[] = [];
  const resultIds: string[] = [];
  const applicantIds: string[] = [];
  const decisionIds: string[] = [];
  const feeStructureIds: string[] = [];
  const invoiceIds: string[] = [];
  const paymentIds: string[] = [];
  const documentIds: string[] = [];
  const verifyTokens: string[] = [];

  let cleanupPool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
    // document_verify_attempts is append-only for pbsms_app (select+insert
    // only) — same gap transport.e2e-spec.ts hit; teardown needs the
    // schema-owning role.
    cleanupPool = new Pool({ connectionString: process.env.MIGRATE_DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      const tokenHashes = verifyTokens.map(hashToken);
      await cleanupPool.query(`delete from document_verify_attempts where token_hash = any($1::text[])`, [tokenHashes]);
      await asHeadmaster(async () => {
        await cleanup.query(`delete from generated_documents where id = any($1::uuid[])`, [documentIds]);
        await cleanup.query(`delete from payment_allocations where payment_id = any($1::uuid[])`, [paymentIds]);
        await cleanup.query(`delete from payments where id = any($1::uuid[])`, [paymentIds]);
        await cleanup.query(`delete from invoice_items where invoice_id = any($1::uuid[])`, [invoiceIds]);
        await cleanup.query(`delete from invoices where id = any($1::uuid[])`, [invoiceIds]);
        await cleanup.query(`delete from fee_instalments where fee_structure_id = any($1::uuid[])`, [feeStructureIds]);
        await cleanup.query(`delete from fee_structure_items where fee_structure_id = any($1::uuid[])`, [feeStructureIds]);
        await cleanup.query(`delete from fee_structures where id = any($1::uuid[])`, [feeStructureIds]);
        await cleanup.query(`delete from promotion_decisions where id = any($1::uuid[])`, [decisionIds]);
        await cleanup.query(`delete from applicants where id = any($1::uuid[])`, [applicantIds]);
        await cleanup.query(`delete from student_result_items where student_result_id = any($1::uuid[])`, [resultIds]);
        await cleanup.query(`delete from student_results where id = any($1::uuid[])`, [resultIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
      });
    } finally {
      cleanup.release();
      await cleanupPool.end();
      await pool.end();
    }
  }, 30000);

  function harness(): { conn: WorkerTenantConnection; service: DocumentsService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new DocumentsService(conn, pool as unknown as typeof PG_POOL & Pool, new NaccaService(conn)) };
  }

  async function createStudent(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-DOC', 'Fixture', $3, $3) returning id`,
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
        [ACADEMIC_YEAR_A, uniqueName('FR-DOC Class'), 'JHS 2', HEADMASTER],
      ),
    );
    classIds.push(rows[0].id);
    return rows[0].id;
  }

  /** Creates a fresh 'draft' result with exactly one snapshotted item —
   * same "insert the item directly, skip the real grading pipeline"
   * shortcut results-visibility.e2e-spec.ts uses. One result per
   * student+class+year (student_results' own unique constraint), so a
   * test that needs both the pre-publish and post-publish state walks
   * THIS SAME row through publishResult() below rather than creating a
   * second one for the same student+class+year. */
  async function createDraftResult(conn: WorkerTenantConnection, studentId: string, classId: string) {
    const results = new ResultsService(conn, new TeacherAssignmentsService(conn));
    const result = await asHeadmaster(() => results.create({ studentId, classId, academicYearId: ACADEMIC_YEAR_A } as never));
    resultIds.push(result.id);
    await asHeadmaster(() =>
      conn.query(
        `insert into student_result_items
           (tenant_id, student_result_id, subject_id, subject_name, grading_policy_id, percentage, grade, is_pass)
         values (current_tenant_id(), $1, $2, 'Mathematics', $3, '81.00', 'A', true)`,
        [result.id, SUBJECT_A, GRADING_POLICY_A],
      ),
    );
    await asHeadmaster(() =>
      conn.query(
        `update student_results set average_percentage = '81.00', subjects_failed_count = 0, overall_pass = true where id = $1`,
        [result.id],
      ),
    );
    return result;
  }

  /** Walks the given draft result's own id through the full legal path to
   * 'published' — same sequence results-visibility.e2e-spec.ts's own
   * publish() helper uses. */
  async function publishResult(conn: WorkerTenantConnection, resultId: string) {
    const results = new ResultsService(conn, new TeacherAssignmentsService(conn));
    await asHeadmaster(() => results.submit(resultId));
    await asHeadmaster(() => results.review(resultId));
    await asHeadmaster(() => results.approve(resultId));
    return asHeadmaster(() => results.publish(resultId));
  }

  /** Convenience for tests that only need an already-published result and
   * don't care about the draft state in between. */
  async function createPublishedResult(conn: WorkerTenantConnection, studentId: string, classId: string) {
    const draft = await createDraftResult(conn, studentId, classId);
    return publishResult(conn, draft.id);
  }

  describe('generateReportCard()', () => {
    it("refuses a 'draft' result, succeeds once published", async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        const classId = await createClass(conn);
        const draft = await createDraftResult(conn, studentId, classId);

        await expect(asHeadmaster(() => service.generateReportCard({ studentResultId: draft.id } as never))).rejects.toThrow(
          /not published\/locked\/archived/,
        );

        const published = await publishResult(conn, draft.id);
        const doc = await asHeadmaster(() => service.generateReportCard({ studentResultId: published.id } as never));
        documentIds.push(doc.id);
        expect(doc.document_type).toBe('report_card');
        expect(doc.reference_number).toMatch(/^RC-\d{6}$/);
        expect(doc.qrCodeDataUri).toMatch(/^data:image\/png;base64,/);
      } finally {
        conn.release();
      }
    });
  });

  describe('getBranding()/upsertBranding() — FR-DOC-030', () => {
    it('upsert fully overwrites (not COALESCEs) every field, and a generated document embeds the current branding', async () => {
      const { conn, service } = harness();
      const original = await asHeadmaster(() => service.getBranding());
      try {
        const first = await asHeadmaster(() =>
          service.upsertBranding({
            schoolNameOverride: 'FR-DOC-030 Test School',
            signatoryName: 'Test Signatory One',
            signatoryTitle: 'Test Title One',
          } as never),
        );
        expect(first.school_name_override).toBe('FR-DOC-030 Test School');
        expect(first.signatory_name).toBe('Test Signatory One');
        expect(first.signatory_title).toBe('Test Title One');
        // Same tenant_branding row updated in place, not a second one.
        expect(first.id).toBe(original?.id);

        // A second call naming only one field overwrites the other two to
        // null -- upsertBranding() is a full replace each time, not a
        // per-field COALESCE like admissions' updateIntake().
        const second = await asHeadmaster(() =>
          service.upsertBranding({ schoolNameOverride: 'FR-DOC-030 Test School Two' } as never),
        );
        expect(second.school_name_override).toBe('FR-DOC-030 Test School Two');
        expect(second.signatory_name).toBeNull();
        expect(second.signatory_title).toBeNull();

        const studentId = await createStudent(conn);
        const classId = await createClass(conn);
        const draft = await createDraftResult(conn, studentId, classId);
        const published = await publishResult(conn, draft.id);
        const doc = await asHeadmaster(() => service.generateReportCard({ studentResultId: published.id } as never));
        documentIds.push(doc.id);
        expect((doc.content as { branding: { school_name_override: string } }).branding.school_name_override).toBe(
          'FR-DOC-030 Test School Two',
        );
      } finally {
        // Restore Tenant A's real seeded branding exactly, regardless of
        // outcome -- this table is shared seed data other tests/fixtures
        // may also rely on.
        await asHeadmaster(() =>
          service.upsertBranding({
            schoolNameOverride: original?.school_name_override ?? undefined,
            signatoryName: original?.signatory_name ?? undefined,
            signatoryTitle: original?.signatory_title ?? undefined,
          } as never),
        );
        conn.release();
      }
    });
  });

  describe('generateAdmissionLetter()', () => {
    it("refuses a non-'admitted' applicant, succeeds once admitted", async () => {
      const { conn, service } = harness();
      try {
        const notAdmitted = await asHeadmaster(() =>
          conn.query<{ id: string }>(
            `insert into applicants (tenant_id, school_id, first_name, last_name, status)
             values (current_tenant_id(), $1, 'Kwame', 'Fixture', 'submitted') returning id`,
            [SCHOOL_A],
          ),
        );
        applicantIds.push(notAdmitted[0].id);

        await expect(
          asHeadmaster(() => service.generateAdmissionLetter({ applicantId: notAdmitted[0].id } as never)),
        ).rejects.toThrow(/not admitted/);

        const admitted = await asHeadmaster(() =>
          conn.query<{ id: string }>(
            `insert into applicants (tenant_id, school_id, first_name, last_name, status, admission_no)
             values (current_tenant_id(), $1, 'Ama', 'Fixture', 'admitted', $2) returning id`,
            [SCHOOL_A, uniqueName('ADM')],
          ),
        );
        applicantIds.push(admitted[0].id);

        const doc = await asHeadmaster(() => service.generateAdmissionLetter({ applicantId: admitted[0].id } as never));
        documentIds.push(doc.id);
        expect(doc.document_type).toBe('admission_letter');
        expect(doc.reference_number).toMatch(/^AL-\d{6}$/);
      } finally {
        conn.release();
      }
    });
  });

  describe('generateCompletionCertificate()', () => {
    it("refuses unless decision='completed' AND status='applied', succeeds once both hold", async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);

        // Two separate students/results — promotion_decisions has a
        // unique(tenant_id, student_id, source_student_result_id), so the
        // 'decided' and 'applied' cases below each need their own row
        // rather than two decisions against the same result.
        const decidedStudentId = await createStudent(conn);
        const decidedResult = await createPublishedResult(conn, decidedStudentId, classId);
        const recommended = await asHeadmaster(() =>
          conn.query<{ id: string }>(
            `insert into promotion_decisions
               (tenant_id, student_id, source_student_result_id, system_recommendation, decision, status, created_by, updated_by)
             values (current_tenant_id(), $1, $2, 'complete', 'completed', 'decided', $3, $3) returning id`,
            [decidedStudentId, decidedResult.id, HEADMASTER],
          ),
        );
        decisionIds.push(recommended[0].id);

        await expect(
          asHeadmaster(() => service.generateCompletionCertificate({ promotionDecisionId: recommended[0].id } as never)),
        ).rejects.toThrow(/requires decision='completed', status='applied'/);

        const appliedStudentId = await createStudent(conn);
        const appliedResult = await createPublishedResult(conn, appliedStudentId, classId);
        const applied = await asHeadmaster(() =>
          conn.query<{ id: string }>(
            `insert into promotion_decisions
               (tenant_id, student_id, source_student_result_id, system_recommendation, decision, status, applied_at, created_by, updated_by)
             values (current_tenant_id(), $1, $2, 'complete', 'completed', 'applied', now(), $3, $3) returning id`,
            [appliedStudentId, appliedResult.id, HEADMASTER],
          ),
        );
        decisionIds.push(applied[0].id);

        const doc = await asHeadmaster(() =>
          service.generateCompletionCertificate({ promotionDecisionId: applied[0].id } as never),
        );
        documentIds.push(doc.id);
        expect(doc.document_type).toBe('completion_certificate');
        expect(doc.reference_number).toMatch(/^CC-\d{6}$/);
      } finally {
        conn.release();
      }
    });
  });

  describe('generateReceipt()', () => {
    it('succeeds for a real allocated payment', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        const finance = new FinanceService(conn);
        const level = uniqueName('FR-DOC-Level');
        const structure = await asHeadmaster(() =>
          finance.createFeeStructure({ academicYearId: ACADEMIC_YEAR_A, level, name: `Doc receipt test ${level}` } as never),
        );
        feeStructureIds.push(structure.id);
        await asHeadmaster(() => finance.addFeeStructureItem(structure.id, { name: 'Tuition', amount: 500 } as never));
        await asHeadmaster(() => finance.addInstalment(structure.id, { sequence: 1, dueDate: '2026-09-01', amount: 500 } as never));
        await asHeadmaster(() => finance.activateFeeStructure(structure.id));
        const invoice = await asHeadmaster(() => finance.generateInvoice({ studentId, feeStructureId: structure.id } as never));
        invoiceIds.push(invoice.id);

        const payment = await asHeadmaster(() =>
          finance.recordPayment({ studentId, method: 'cash', amount: 500 } as never),
        );
        paymentIds.push(payment.id);
        await asHeadmaster(() => finance.allocate(payment.id, { invoiceId: invoice.id, amount: 500 } as never));

        const doc = await asHeadmaster(() => service.generateReceipt({ paymentId: payment.id } as never));
        documentIds.push(doc.id);
        expect(doc.document_type).toBe('receipt');
        expect(doc.reference_number).toMatch(/^RCT-\d{6}$/);
      } finally {
        conn.release();
      }
    });
  });

  describe('revoke()', () => {
    it('succeeds once, refuses a second revocation of the same document', async () => {
      const { conn, service } = harness();
      try {
        const admitted = await asHeadmaster(() =>
          conn.query<{ id: string }>(
            `insert into applicants (tenant_id, school_id, first_name, last_name, status, admission_no)
             values (current_tenant_id(), $1, 'Kofi', 'Fixture', 'admitted', $2) returning id`,
            [SCHOOL_A, uniqueName('ADM')],
          ),
        );
        applicantIds.push(admitted[0].id);
        const doc = await asHeadmaster(() => service.generateAdmissionLetter({ applicantId: admitted[0].id } as never));
        documentIds.push(doc.id);

        const revoked = await asHeadmaster(() => service.revoke(doc.id, { reason: 'Issued in error' } as never));
        expect(revoked.revoked_at).not.toBeNull();

        await expect(asHeadmaster(() => service.revoke(doc.id, { reason: 'Again' } as never))).rejects.toThrow(
          /already revoked/,
        );
      } finally {
        conn.release();
      }
    });
  });

  describe('verify() — FR-DOC-020, no tenant context', () => {
    it('is valid for a real token, invalid for a bogus one, and reports revoked after revoke()', async () => {
      const { conn, service } = harness();
      try {
        const admitted = await asHeadmaster(() =>
          conn.query<{ id: string }>(
            `insert into applicants (tenant_id, school_id, first_name, last_name, status, admission_no)
             values (current_tenant_id(), $1, 'Yaw', 'Fixture', 'admitted', $2) returning id`,
            [SCHOOL_A, uniqueName('ADM')],
          ),
        );
        applicantIds.push(admitted[0].id);
        const doc = await asHeadmaster(() => service.generateAdmissionLetter({ applicantId: admitted[0].id } as never));
        documentIds.push(doc.id);
        verifyTokens.push(doc.verification_token);

        const bogusToken = `bogus-${uniqueName('token')}`;
        verifyTokens.push(bogusToken);
        const bogusResult = await service.verify(bogusToken);
        expect(bogusResult.valid).toBe(false);

        const validResult = await service.verify(doc.verification_token);
        expect(validResult.valid).toBe(true);
        expect(validResult.referenceNumber).toBe(doc.reference_number);
        expect(validResult.revoked).toBe(false);

        await asHeadmaster(() => service.revoke(doc.id, { reason: 'Testing revoked verify() flag' } as never));
        const afterRevoke = await service.verify(doc.verification_token);
        expect(afterRevoke.revoked).toBe(true);
      } finally {
        conn.release();
      }
    });

    it('rate-limits repeated attempts against the same token to 20 per 15 minutes', async () => {
      const { conn, service } = harness();
      try {
        const rateLimitToken = `rate-limit-${uniqueName('token')}`;
        verifyTokens.push(rateLimitToken);

        for (let i = 0; i < 20; i++) {
          const result = await service.verify(rateLimitToken);
          expect(result.valid).toBe(false);
        }

        await expect(service.verify(rateLimitToken)).rejects.toThrow(/Too many verification attempts/);
      } finally {
        conn.release();
      }
    });
  });
});
