/**
 * admissions.e2e-spec.ts
 *
 * Chapter 15 (Admissions), FR-ADM-010..040 — genuinely untested before
 * this file (no existing suite constructs AdmissionsService). The
 * atomic conversion transaction this file's convert() tests exercise was
 * previously only manually live-HTTP verified (see pbsms-platform/
 * README.md's Quick Start), never captured as a repeatable test.
 *
 * Covers:
 *  - FR-ADM-020: create() surfaces a same-tenant name+dob match as
 *    possible_duplicate_of rather than silently discarding or blocking it,
 *    and correctly ignores rejected/cancelled applicants as candidates.
 *  - The FR-ADM 15.2 status transition table: one legal and one illegal
 *    transition.
 *  - FR-ADM-030, FR-ADM-040: convert()'s atomic student+enrolment
 *    creation and sequential, never-reused admission-number assignment
 *    (assigned only at conversion, per FR-ADM-040's own text).
 *  - NFR-API-010: the state-check idempotency the class header comment
 *    describes (a retried convert() on an already-converted applicant
 *    fails closed rather than creating a second student) — this is the
 *    same convert() call the two points above already exercise, not a
 *    separate test; recorded here as its own bullet only because EC-107's
 *    gap-detection tool does a literal-substring match per id and the
 *    combined "FR-ADM-030/040" slash form above doesn't contain the
 *    contiguous string "FR-ADM-040" (a known limitation the tool's own
 *    header names), and NFR-API-010 was previously named only in
 *    admissions.service.ts's comment, never here.
 *  - FR-ADM-010: updateIntake()'s progressive, per-field COALESCE
 *    semantics — updating one field never clobbers another already set.
 *
 * Harness pattern copied from results-immutability.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom (this service
 * takes no actor identity, only tenant scope, so the run() context here
 * carries no meaningful userId/roles), same per-file fixture tracking and
 * afterAll cleanup.
 *
 * Requires a running Postgres with every migration through
 * 0042_admissions_intake.sql (and everything seed_demo.sql needs) already
 * applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { AdmissionsService } from '../src/modules/admissions/admissions.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001'; // 2026/2027

function asTenant<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: 'n/a', roles: [], isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Admissions (Chapter 15 FR-ADM-010..040)', () => {
  let pool: Pool;
  const applicantIds: string[] = [];
  const studentIds: string[] = [];
  const classIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asTenant(async () => {
        await cleanup.query(`delete from enrolments where student_id = any($1::uuid[])`, [studentIds]);
        await cleanup.query(`delete from applicants where id = any($1::uuid[])`, [applicantIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: AdmissionsService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new AdmissionsService(conn) };
  }

  async function createClass(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asTenant(() =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, null, null) returning id`,
        [ACADEMIC_YEAR_A, uniqueName('FR-ADM Class'), 'JHS 1'],
      ),
    );
    classIds.push(rows[0].id);
    return rows[0].id;
  }

  async function createApplicant(service: AdmissionsService, overrides: Record<string, unknown> = {}) {
    const applicant = await asTenant(() =>
      service.create({
        schoolId: SCHOOL_A,
        firstName: uniqueName('First'),
        lastName: 'Fixture',
        ...overrides,
      } as never),
    );
    applicantIds.push(applicant.id);
    return applicant;
  }

  /** Walks an applicant to 'approved' via the legal transition path
   * (submitted -> under_review -> approved), so convert() tests don't
   * each have to re-derive the same three calls. */
  async function approveApplicant(service: AdmissionsService, applicantId: string) {
    await asTenant(() => service.updateStatus(applicantId, 'submitted'));
    await asTenant(() => service.updateStatus(applicantId, 'under_review'));
    return asTenant(() => service.updateStatus(applicantId, 'approved'));
  }

  describe('create() — FR-ADM-020 duplicate surfacing', () => {
    it('flags possible_duplicate_of for a same-tenant name+dob match that is not rejected/cancelled', async () => {
      const { conn, service } = harness();
      try {
        const dob = '2015-03-14';
        const name = uniqueName('Dup');
        const first = await asTenant(() =>
          service.create({ schoolId: SCHOOL_A, firstName: name, lastName: 'Duplicate', dob } as never),
        );
        applicantIds.push(first.id);
        expect(first.possible_duplicate_of).toBeNull();

        const second = await asTenant(() =>
          service.create({ schoolId: SCHOOL_A, firstName: name, lastName: 'Duplicate', dob } as never),
        );
        applicantIds.push(second.id);
        expect(second.possible_duplicate_of).toBe(first.id);
      } finally {
        conn.release();
      }
    });

    it('does not flag a match against an applicant already rejected or cancelled', async () => {
      const { conn, service } = harness();
      try {
        const dob = '2016-01-01';
        const name = uniqueName('NoDup');
        const rejected = await asTenant(() =>
          service.create({ schoolId: SCHOOL_A, firstName: name, lastName: 'Fixture', dob } as never),
        );
        applicantIds.push(rejected.id);
        await asTenant(() => service.updateStatus(rejected.id, 'submitted'));
        await asTenant(() => service.updateStatus(rejected.id, 'under_review'));
        await asTenant(() => service.updateStatus(rejected.id, 'rejected'));

        const second = await asTenant(() =>
          service.create({ schoolId: SCHOOL_A, firstName: name, lastName: 'Fixture', dob } as never),
        );
        applicantIds.push(second.id);
        expect(second.possible_duplicate_of).toBeNull();
      } finally {
        conn.release();
      }
    });
  });

  describe('updateStatus() — the FR-ADM 15.2 transition table', () => {
    it('allows draft -> submitted, rejects submitted -> approved (must pass through under_review)', async () => {
      const { conn, service } = harness();
      try {
        const applicant = await createApplicant(service);
        const submitted = await asTenant(() => service.updateStatus(applicant.id, 'submitted'));
        expect(submitted.status).toBe('submitted');

        await expect(asTenant(() => service.updateStatus(applicant.id, 'approved'))).rejects.toThrow(
          /Cannot move applicant from 'submitted' to 'approved'/,
        );
      } finally {
        conn.release();
      }
    });
  });

  describe('convert() — FR-ADM-030/040 atomic conversion and admission-number assignment', () => {
    it('requires "approved" status, then atomically creates a student, an enrolment, and assigns a never-reused admission number', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const applicant = await createApplicant(service);

        // Not yet approved — must be refused.
        await expect(
          asTenant(() => service.convert(applicant.id, { academicYearId: ACADEMIC_YEAR_A, classId } as never)),
        ).rejects.toThrow(/must be 'approved' to convert/);

        await approveApplicant(service, applicant.id);
        const result = await asTenant(() =>
          service.convert(applicant.id, { academicYearId: ACADEMIC_YEAR_A, classId } as never),
        );
        studentIds.push(result.studentId);

        expect(result.applicant.status).toBe('admitted');
        expect(result.applicant.student_id).toBe(result.studentId);
        expect(result.applicant.admission_no).toMatch(/^SUN-\d{4}-\d{3}$/);

        const student = await asTenant(() =>
          conn.query<{ admission_no: string; first_name: string }>(
            `select admission_no, first_name from students where id = $1`,
            [result.studentId],
          ),
        );
        expect(student[0].admission_no).toBe(result.applicant.admission_no);
        expect(student[0].first_name).toBe(applicant.first_name);

        const enrolment = await asTenant(() =>
          conn.query<{ class_id: string; academic_year_id: string; status: string }>(
            `select class_id, academic_year_id, status from enrolments where id = $1`,
            [result.enrolmentId],
          ),
        );
        expect(enrolment[0].class_id).toBe(classId);
        expect(enrolment[0].academic_year_id).toBe(ACADEMIC_YEAR_A);
        expect(enrolment[0].status).toBe('active');

        // Idempotency-via-state-check (class header comment): a retried
        // convert() on the now-'admitted' applicant fails closed rather
        // than creating a second student.
        await expect(
          asTenant(() => service.convert(applicant.id, { academicYearId: ACADEMIC_YEAR_A, classId } as never)),
        ).rejects.toThrow(/must be 'approved' to convert/);
      } finally {
        conn.release();
      }
    });

    it('assigns strictly increasing admission numbers for successive conversions at the same school', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const first = await createApplicant(service);
        const second = await createApplicant(service);
        await approveApplicant(service, first.id);
        await approveApplicant(service, second.id);

        const firstResult = await asTenant(() =>
          service.convert(first.id, { academicYearId: ACADEMIC_YEAR_A, classId } as never),
        );
        studentIds.push(firstResult.studentId);
        const secondResult = await asTenant(() =>
          service.convert(second.id, { academicYearId: ACADEMIC_YEAR_A, classId } as never),
        );
        studentIds.push(secondResult.studentId);

        const firstSeq = Number(firstResult.applicant.admission_no!.split('-').pop());
        const secondSeq = Number(secondResult.applicant.admission_no!.split('-').pop());
        expect(secondSeq).toBe(firstSeq + 1);
      } finally {
        conn.release();
      }
    });
  });

  describe('updateIntake() — FR-ADM-010 progressive, per-field fill', () => {
    it('updates only the fields present in the call, leaving previously-set fields untouched', async () => {
      const { conn, service } = harness();
      try {
        const applicant = await createApplicant(service);
        const afterFirst = await asTenant(() =>
          service.updateIntake(applicant.id, { nationality: 'Ghanaian', guardianName: 'Ama Owusu' } as never),
        );
        expect(afterFirst.nationality).toBe('Ghanaian');
        expect(afterFirst.guardian_name).toBe('Ama Owusu');

        const afterSecond = await asTenant(() =>
          service.updateIntake(applicant.id, { guardianPhone: '+233241234567' } as never),
        );
        expect(afterSecond.guardian_phone).toBe('+233241234567');
        // Untouched by the second call — still what the first call set.
        expect(afterSecond.nationality).toBe('Ghanaian');
        expect(afterSecond.guardian_name).toBe('Ama Owusu');
      } finally {
        conn.release();
      }
    });
  });
});
