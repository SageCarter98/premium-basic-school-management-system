/**
 * promotion.e2e-spec.ts
 *
 * Chapter 22.2 (Promotion & JHS Completion), FR-PRO-010..030 — genuinely
 * untested before this file (no existing suite constructs
 * PromotionService at all).
 *
 *  - FR-PRO-010: recommend() derives a system recommendation from an
 *    approved result (pass -> promote, except a JHS 3 pass -> complete;
 *    fail -> repeat), and refuses a not-yet-approved source result.
 *  - FR-PRO-020: the recommendation/decision separation — recommend()
 *    only ever writes system_recommendation, decide() is the only method
 *    that writes decision, and decide() itself requires the row to still
 *    be in 'recommended' status.
 *  - FR-PRO-030: apply() closes the prior enrolment (status/end_date/
 *    closed_reason only — never mutated in place otherwise) rather than
 *    deleting or overwriting it, and creates a genuinely new enrolment
 *    for the destination-requiring decisions; 'transferred'/'completed'
 *    are terminal (student status changes, no new enrolment).
 *
 * Fixtures use student_results rows inserted directly at the target
 * status (published/draft) rather than routing through
 * results.service.ts's own transition state machine — that state machine
 * is results-immutability.e2e-spec.ts's (EC-400 protected) concern, not
 * this file's.
 *
 * Harness pattern copied from results-immutability.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom, same
 * "own class/students/year per test" and afterAll cleanup discipline.
 *
 * Requires a running Postgres with every migration through
 * 0007_promotion_documents.sql (and everything seed_demo.sql needs)
 * already applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { PromotionService } from '../src/modules/promotion/promotion.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001'; // 2026/2027
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

function asUser<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Promotion (Chapter 22.2 FR-PRO-010..030)', () => {
  let pool: Pool;
  const yearIds: string[] = [];
  const classIds: string[] = [];
  const studentIds: string[] = [];
  const resultIds: string[] = [];
  const decisionIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asUser(async () => {
        await cleanup.query(`delete from promotion_decisions where id = any($1::uuid[])`, [decisionIds]);
        await cleanup.query(`delete from enrolments where student_id = any($1::uuid[])`, [studentIds]);
        await cleanup.query(`delete from student_results where id = any($1::uuid[])`, [resultIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
        await cleanup.query(`delete from academic_years where id = any($1::uuid[])`, [yearIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: PromotionService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new PromotionService(conn) };
  }

  async function createNextYear(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asUser(() =>
      conn.query<{ id: string }>(
        `insert into academic_years (tenant_id, school_id, name, status, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'planned', $3, $3) returning id`,
        [SCHOOL_A, uniqueName('FR-PRO Year'), HEADMASTER],
      ),
    );
    yearIds.push(rows[0].id);
    return rows[0].id;
  }

  async function createClass(conn: WorkerTenantConnection, level: string, academicYearId = ACADEMIC_YEAR_A): Promise<string> {
    const rows = await asUser(() =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [academicYearId, uniqueName('FR-PRO Class'), level, HEADMASTER],
      ),
    );
    classIds.push(rows[0].id);
    return rows[0].id;
  }

  async function createEnrolledStudent(conn: WorkerTenantConnection, classId: string, academicYearId = ACADEMIC_YEAR_A) {
    const studentRows = await asUser(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-PRO', 'Fixture', $3, $3) returning id`,
        [SCHOOL_A, uniqueName('ADM'), HEADMASTER],
      ),
    );
    const studentId = studentRows[0].id;
    studentIds.push(studentId);
    const enrolmentRows = await asUser(() =>
      conn.query<{ id: string }>(
        `insert into enrolments (tenant_id, student_id, academic_year_id, class_id, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [studentId, academicYearId, classId, HEADMASTER],
      ),
    );
    return { studentId, enrolmentId: enrolmentRows[0].id };
  }

  /** A student_results row at the given status/overall_pass, inserted
   * directly rather than via results.service.ts's own transitions. */
  async function createResult(conn: WorkerTenantConnection, studentId: string, classId: string, status: string, overallPass: boolean | null) {
    const rows = await asUser(() =>
      conn.query<{ id: string }>(
        `insert into student_results (tenant_id, student_id, class_id, academic_year_id, version, status, overall_pass, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, 1, $4, $5, $6, $6) returning id`,
        [studentId, classId, ACADEMIC_YEAR_A, status, overallPass, HEADMASTER],
      ),
    );
    resultIds.push(rows[0].id);
    return rows[0].id;
  }

  describe('recommend() — FR-PRO-010', () => {
    it('recommends "promote" for a pass in a non-terminal class', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn, 'JHS 2');
        const { studentId } = await createEnrolledStudent(conn, classId);
        const resultId = await createResult(conn, studentId, classId, 'published', true);

        const decision = await asUser(() => service.recommend({ sourceStudentResultId: resultId } as never));
        decisionIds.push(decision.id);
        expect(decision.system_recommendation).toBe('promote');
        expect(decision.status).toBe('recommended');
      } finally {
        conn.release();
      }
    });

    it('recommends "complete" for a pass in JHS 3 (Basic Education completion)', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn, 'JHS 3');
        const { studentId } = await createEnrolledStudent(conn, classId);
        const resultId = await createResult(conn, studentId, classId, 'locked', true);

        const decision = await asUser(() => service.recommend({ sourceStudentResultId: resultId } as never));
        decisionIds.push(decision.id);
        expect(decision.system_recommendation).toBe('complete');
      } finally {
        conn.release();
      }
    });

    it('recommends "repeat" for a fail, regardless of class level', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn, 'JHS 2');
        const { studentId } = await createEnrolledStudent(conn, classId);
        const resultId = await createResult(conn, studentId, classId, 'published', false);

        const decision = await asUser(() => service.recommend({ sourceStudentResultId: resultId } as never));
        decisionIds.push(decision.id);
        expect(decision.system_recommendation).toBe('repeat');
      } finally {
        conn.release();
      }
    });

    it('refuses a source result that is not yet approved (still draft)', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn, 'JHS 2');
        const { studentId } = await createEnrolledStudent(conn, classId);
        const resultId = await createResult(conn, studentId, classId, 'draft', true);

        await expect(asUser(() => service.recommend({ sourceStudentResultId: resultId } as never))).rejects.toThrow(
          /not published\/locked\/archived/,
        );
      } finally {
        conn.release();
      }
    });
  });

  describe('recommend()/decide() separation — FR-PRO-020', () => {
    it('recommend() never sets decision; only decide() does, and only from "recommended"', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn, 'JHS 2');
        const { studentId } = await createEnrolledStudent(conn, classId);
        const resultId = await createResult(conn, studentId, classId, 'published', true);

        const recommended = await asUser(() => service.recommend({ sourceStudentResultId: resultId } as never));
        decisionIds.push(recommended.id);
        expect(recommended.decision).toBeNull();

        // decide() rejects a decision requiring a destination with none given.
        await expect(
          asUser(() => service.decide(recommended.id, { decision: 'promoted' } as never)),
        ).rejects.toThrow(/requires both toClassId and toAcademicYearId/);

        const nextYear = await createNextYear(conn);
        const nextClass = await createClass(conn, 'JHS 3', nextYear);
        const decided = await asUser(() =>
          service.decide(recommended.id, { decision: 'promoted', toClassId: nextClass, toAcademicYearId: nextYear } as never),
        );
        expect(decided.decision).toBe('promoted');
        expect(decided.status).toBe('decided');
        expect(decided.decided_by).toBe(HEADMASTER);

        // Can't decide() an already-decided row again.
        await expect(
          asUser(() => service.decide(recommended.id, { decision: 'repeated', toClassId: classId, toAcademicYearId: ACADEMIC_YEAR_A } as never)),
        ).rejects.toThrow(/not recommended/);
      } finally {
        conn.release();
      }
    });
  });

  describe('apply() — FR-PRO-030 closes the prior enrolment rather than mutating it', () => {
    it('promoted: closes the source enrolment and opens a genuinely new one in the destination class/year', async () => {
      const { conn, service } = harness();
      try {
        const sourceClass = await createClass(conn, 'JHS 2');
        const { studentId, enrolmentId: oldEnrolmentId } = await createEnrolledStudent(conn, sourceClass);
        const resultId = await createResult(conn, studentId, sourceClass, 'published', true);

        const recommended = await asUser(() => service.recommend({ sourceStudentResultId: resultId } as never));
        decisionIds.push(recommended.id);
        const nextYear = await createNextYear(conn);
        const destClass = await createClass(conn, 'JHS 3', nextYear);
        await asUser(() =>
          service.decide(recommended.id, { decision: 'promoted', toClassId: destClass, toAcademicYearId: nextYear } as never),
        );

        const applied = await asUser(() => service.apply(recommended.id));
        expect(applied.status).toBe('applied');
        expect(applied.new_enrolment_id).not.toBeNull();

        const oldEnrolment = await asUser(() =>
          conn.query<{ status: string; end_date: string | null; class_id: string }>(
            `select status, end_date, class_id from enrolments where id = $1`,
            [oldEnrolmentId],
          ),
        );
        expect(oldEnrolment[0].status).toBe('closed');
        expect(oldEnrolment[0].end_date).not.toBeNull();
        expect(oldEnrolment[0].class_id).toBe(sourceClass); // never mutated, only closed

        const newEnrolment = await asUser(() =>
          conn.query<{ class_id: string; academic_year_id: string; status: string }>(
            `select class_id, academic_year_id, status from enrolments where id = $1`,
            [applied.new_enrolment_id],
          ),
        );
        expect(newEnrolment[0].class_id).toBe(destClass);
        expect(newEnrolment[0].academic_year_id).toBe(nextYear);
        expect(newEnrolment[0].status).toBe('active');
      } finally {
        conn.release();
      }
    });

    it('completed (JHS 3 pass): closes the enrolment, graduates the student, opens no new enrolment', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn, 'JHS 3');
        const { studentId, enrolmentId } = await createEnrolledStudent(conn, classId);
        const resultId = await createResult(conn, studentId, classId, 'published', true);

        const recommended = await asUser(() => service.recommend({ sourceStudentResultId: resultId } as never));
        decisionIds.push(recommended.id);
        expect(recommended.system_recommendation).toBe('complete');
        await asUser(() => service.decide(recommended.id, { decision: 'completed' } as never));

        const applied = await asUser(() => service.apply(recommended.id));
        expect(applied.new_enrolment_id).toBeNull();

        const enrolment = await asUser(() =>
          conn.query<{ status: string }>(`select status from enrolments where id = $1`, [enrolmentId]),
        );
        expect(enrolment[0].status).toBe('closed');

        const student = await asUser(() =>
          conn.query<{ status: string }>(`select status from students where id = $1`, [studentId]),
        );
        expect(student[0].status).toBe('graduated');
      } finally {
        conn.release();
      }
    });
  });
});
