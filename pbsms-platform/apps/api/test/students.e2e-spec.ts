/**
 * students.e2e-spec.ts
 *
 * Chapter 31 (students table), FR-STU-010 — genuinely untested before this
 * file (no existing suite constructs StudentsService, despite its own
 * header calling itself "the reference implementation... every other
 * tenant-scoped module should copy"). FR-STU-010's text: "Maintain a
 * permanent identifier separate from admission number and from yearly
 * enrolment."
 *
 * Covers:
 *  - Identity permanence: the same student.id/admission_no is returned
 *    across two DIFFERENT academic-year enrolments (a fresh academic_years
 *    fixture, since seed_demo.sql only seeds one year for Tenant A) —
 *    proving identity doesn't fork, duplicate, or depend on which year's
 *    enrolment is being queried. findOne() takes no year/enrolment
 *    parameter at all, reinforcing the same point.
 *  - findAll()'s classId/academicYearId filters correctly route through
 *    an EXISTS against enrolments (a fact about the enrolment, not a
 *    column on students itself), rather than filtering students directly.
 *  - Chapter 13.3 scope: an unassigned teacher's findAll()/findOne() both
 *    exclude the student; the assigned teacher sees them; an
 *    ACADEMIC_ADMIN caller (headmaster) is unrestricted.
 *  - create() is tenant-safe via current_tenant_id() regardless of any
 *    caller-supplied value (there is none to supply — the DTO has no
 *    tenantId field at all).
 *
 * Harness pattern copied from discipline.e2e-spec.ts (WorkerTenantConnection
 * + TenantContextStore.run() idiom, teacher_assignments fixture helper).
 *
 * Requires a running Postgres with every migration through
 * 0020_teacher_assignments.sql (and seed_demo.sql) applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { StudentsService } from '../src/modules/students/students.service';
import { TeacherAssignmentsService } from '../src/modules/teacher-assignments/teacher-assignments.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001'; // 2026/2027 (seeded)
const SUBJECT_A = '55555555-0000-0000-0000-000000000001'; // Mathematics
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise
const TEACHER_SUNRISE = '99999999-0000-0000-0000-000000000003'; // teacher@sunrise

function asUser<T>(userId: string, roles: string[], fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId, roles, isPlatformUser: false }, fn);
}
function asHeadmaster<T>(fn: () => Promise<T>): Promise<T> {
  return asUser(HEADMASTER, ['headmaster'], fn);
}
function asTeacher<T>(fn: () => Promise<T>): Promise<T> {
  return asUser(TEACHER_SUNRISE, ['teacher'], fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Students (Chapter 31, FR-STU-010)', () => {
  let pool: Pool;
  const studentIds: string[] = [];
  const classIds: string[] = [];
  const enrolmentIds: string[] = [];
  const academicYearIds: string[] = [];
  const assignmentIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asHeadmaster(async () => {
        await cleanup.query(`delete from teacher_assignments where id = any($1::uuid[])`, [assignmentIds]);
        await cleanup.query(`delete from enrolments where id = any($1::uuid[])`, [enrolmentIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from academic_years where id = any($1::uuid[])`, [academicYearIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: StudentsService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new StudentsService(conn, new TeacherAssignmentsService(conn)) };
  }

  async function createClass(conn: WorkerTenantConnection, academicYearId: string): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [academicYearId, uniqueName('FR-STU Class'), 'JHS 2', HEADMASTER],
      ),
    );
    classIds.push(rows[0].id);
    return rows[0].id;
  }

  async function createSecondAcademicYear(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into academic_years (tenant_id, school_id, name, status, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'active', $3, $3) returning id`,
        [SCHOOL_A, uniqueName('FR-STU Year'), HEADMASTER],
      ),
    );
    academicYearIds.push(rows[0].id);
    return rows[0].id;
  }

  async function enrol(conn: WorkerTenantConnection, studentId: string, academicYearId: string, classId: string) {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into enrolments (tenant_id, student_id, academic_year_id, class_id, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [studentId, academicYearId, classId, HEADMASTER],
      ),
    );
    enrolmentIds.push(rows[0].id);
  }

  async function assignTeacher(conn: WorkerTenantConnection, classId: string, academicYearId: string) {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into teacher_assignments (tenant_id, teacher_id, class_id, subject_id, academic_year_id, is_class_teacher, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, true, $5, $5) returning id`,
        [TEACHER_SUNRISE, classId, SUBJECT_A, academicYearId, HEADMASTER],
      ),
    );
    assignmentIds.push(rows[0].id);
  }

  it('create() is tenant-safe via current_tenant_id() and returns a permanent id distinct from admission_no', async () => {
    const { conn, service } = harness();
    try {
      const student = await asHeadmaster(() =>
        service.create({ schoolId: SCHOOL_A, admissionNo: uniqueName('ADM'), firstName: 'Ama', lastName: 'Fixture' }),
      );
      studentIds.push(student.id);
      expect(student.tenant_id).toBe(TENANT_A);
      expect(student.id).not.toBe(student.admission_no);
    } finally {
      conn.release();
    }
  });

  it('the same id/admission_no is returned across two different academic-year enrolments', async () => {
    const { conn, service } = harness();
    try {
      const admissionNo = uniqueName('ADM');
      const student = await asHeadmaster(() =>
        service.create({ schoolId: SCHOOL_A, admissionNo, firstName: 'Kojo', lastName: 'Fixture' }),
      );
      studentIds.push(student.id);

      const classYear1 = await createClass(conn, ACADEMIC_YEAR_A);
      await enrol(conn, student.id, ACADEMIC_YEAR_A, classYear1);

      const year2 = await createSecondAcademicYear(conn);
      const classYear2 = await createClass(conn, year2);
      await enrol(conn, student.id, year2, classYear2);

      const resultsYear1 = await asHeadmaster(() =>
        service.findAll({ academicYearId: ACADEMIC_YEAR_A, classId: classYear1 }),
      );
      const resultsYear2 = await asHeadmaster(() => service.findAll({ academicYearId: year2, classId: classYear2 }));

      expect(resultsYear1).toHaveLength(1);
      expect(resultsYear2).toHaveLength(1);
      // Same permanent record both times -- identity does not fork across
      // yearly enrolments.
      expect(resultsYear1[0].id).toBe(student.id);
      expect(resultsYear2[0].id).toBe(student.id);
      expect(resultsYear1[0].admission_no).toBe(admissionNo);
      expect(resultsYear2[0].admission_no).toBe(admissionNo);

      // findOne() needs no year/enrolment parameter at all.
      const found = await asHeadmaster(() => service.findOne(student.id));
      expect(found.admission_no).toBe(admissionNo);
    } finally {
      conn.release();
    }
  });

  describe('Chapter 13.3 record scoping', () => {
    it('an unassigned teacher sees nothing; the assigned teacher and an ACADEMIC_ADMIN caller both see the student', async () => {
      const { conn, service } = harness();
      try {
        const student = await asHeadmaster(() =>
          service.create({ schoolId: SCHOOL_A, admissionNo: uniqueName('ADM'), firstName: 'Efua', lastName: 'Fixture' }),
        );
        studentIds.push(student.id);
        const classId = await createClass(conn, ACADEMIC_YEAR_A);
        await enrol(conn, student.id, ACADEMIC_YEAR_A, classId);

        // Unassigned: findAll excludes them, findOne 404s.
        const unassignedResults = await asTeacher(() => service.findAll({ classId, academicYearId: ACADEMIC_YEAR_A }));
        expect(unassignedResults).toHaveLength(0);
        await expect(asTeacher(() => service.findOne(student.id))).rejects.toThrow(/not found/);

        await assignTeacher(conn, classId, ACADEMIC_YEAR_A);

        const assignedResults = await asTeacher(() => service.findAll({ classId, academicYearId: ACADEMIC_YEAR_A }));
        expect(assignedResults.map((s) => s.id)).toContain(student.id);
        const assignedFound = await asTeacher(() => service.findOne(student.id));
        expect(assignedFound.id).toBe(student.id);

        // Headmaster (ACADEMIC_ADMIN tier) is unrestricted regardless.
        const adminFound = await asHeadmaster(() => service.findOne(student.id));
        expect(adminFound.id).toBe(student.id);
      } finally {
        conn.release();
      }
    });
  });
});
