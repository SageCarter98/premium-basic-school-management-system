/**
 * results-visibility.e2e-spec.ts
 *
 * Covers Chapter 21 FR-RES-040 (published-only, role-appropriate visibility)
 * and the implemented slice of FR-RES-050 (class-level analytics) —
 * genuinely different requirements from FR-RES-020/030, which is what
 * `results-immutability.e2e-spec.ts` (an EC-400 protected suite) already
 * covers. Deliberately a separate file rather than an addition to that one:
 * EC-400 permits new cases in a PR touching nothing else, but these
 * requirements were never in scope for that suite's own describe blocks, so
 * a new file keeps the protected suite's existing content untouched and
 * avoids any question of whether this counts as "modifying" it.
 *
 * FR-RES-050's full text also asks for student-trend, subject-performance,
 * division-comparison, promotion-readiness and an optional BECE mock-exam
 * view — results.service.ts's own header comment names these as documented
 * future scope, not built yet. This file only tests classAnalytics(), the
 * one piece that exists.
 *
 * Harness, fixture and cleanup pattern copied from
 * results-immutability.e2e-spec.ts (see that file's header for the full
 * rationale) — same WorkerTenantConnection + TenantContextStore.run()
 * idiom, same "own class per test, never the shared seeded fixture" rule,
 * same afterAll cleanup requirement.
 *
 * One addition this file needs that the immutability suite didn't: a
 * genuinely scope-restricted actor, to prove findPublishedForStudent()
 * ignores scope (guardian-facing) while findPublishedForStudentAsStaff()
 * and classAnalytics() enforce it (staff-facing). getCallerScope() treats
 * a caller as restricted only when 'teacher' is their SOLE role — the
 * seeded `teacher@sunrise.pbsms.test` (TEACHER_SUNRISE below) is used for
 * this, given an explicit teacher_assignments row for exactly the classes
 * this file wants them scoped INTO, and never assigned to the classes it
 * wants them scoped OUT of.
 *
 * Requires a running Postgres with every migration through
 * 0020_teacher_assignments.sql (and everything seed_demo.sql needs) already
 * applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { ResultsService } from '../src/modules/results/results.service';
import { TeacherAssignmentsService } from '../src/modules/teacher-assignments/teacher-assignments.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001';
const STUDENT_A = 'eeeeeeee-0000-0000-0000-000000000001'; // Ama Mensah
const SUBJECT_A = '55555555-0000-0000-0000-000000000001'; // Mathematics
const GRADING_POLICY_A = 'a0000000-0000-0000-0000-000000000001';
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise
const TEACHER_SUNRISE = '99999999-0000-0000-0000-000000000003'; // teacher@sunrise, seed_demo.sql's only real seeded teacher

function asHeadmaster<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

/** 'teacher' as the caller's SOLE role is what makes getCallerScope() treat
 * them as restricted rather than unrestricted — see teacher-assignments
 * .service.ts's getCallerScope() doc comment. */
function asScopedTeacher<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: TEACHER_SUNRISE, roles: ['teacher'], isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Results visibility and analytics (Chapter 21 FR-RES-040/050)', () => {
  let pool: Pool;
  const classIds: string[] = [];
  const studentIds: string[] = [];
  const resultIds: string[] = [];
  const assignmentIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asHeadmaster(async () => {
        await cleanup.query(`delete from teacher_assignments where id = any($1::uuid[])`, [assignmentIds]);
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

  function harness(): { conn: WorkerTenantConnection; service: ResultsService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new ResultsService(conn, new TeacherAssignmentsService(conn)) };
  }

  async function createClass(conn: WorkerTenantConnection, assignScopedTeacher: boolean): Promise<string> {
    const classRows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [ACADEMIC_YEAR_A, uniqueName('FR-RES-040 Class'), 'JHS 2', HEADMASTER],
      ),
    );
    const classId = classRows[0].id;
    classIds.push(classId);

    if (assignScopedTeacher) {
      const assignmentRows = await asHeadmaster(() =>
        conn.query<{ id: string }>(
          `insert into teacher_assignments (tenant_id, teacher_id, class_id, subject_id, academic_year_id, is_class_teacher, created_by, updated_by)
           values (current_tenant_id(), $1, $2, $3, $4, true, $5, $5) returning id`,
          [TEACHER_SUNRISE, classId, SUBJECT_A, ACADEMIC_YEAR_A, HEADMASTER],
        ),
      );
      assignmentIds.push(assignmentRows[0].id);
    }

    return classId;
  }

  async function createStudent(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-RES-040', 'Fixture', $3, $3) returning id`,
        [SCHOOL_A, uniqueName('ADM'), HEADMASTER],
      ),
    );
    const studentId = rows[0].id;
    studentIds.push(studentId);
    return studentId;
  }

  /** Creates a draft result with exactly one snapshotted item at the given
   * percentage/pass value — same "insert the item directly, skip the real
   * grading pipeline" shortcut results-immutability.e2e-spec.ts uses.
   * create()'s own call to the private snapshotItems() finds nothing to
   * snapshot (no assessment_structures/result_candidates fixtures exist
   * here), so it leaves student_results.average_percentage/overall_pass
   * null — this helper sets them directly afterwards to what a real
   * pipeline would have computed for this one item, since classAnalytics()
   * aggregates those columns, not the item rows themselves. */
  async function createDraftResult(
    conn: WorkerTenantConnection,
    service: ResultsService,
    studentId: string,
    classId: string,
    percentage: string,
    isPass: boolean,
  ) {
    const result = await asHeadmaster(() =>
      service.create({ studentId, classId, academicYearId: ACADEMIC_YEAR_A } as never),
    );
    resultIds.push(result.id);
    await asHeadmaster(() =>
      conn.query(
        `insert into student_result_items
           (tenant_id, student_result_id, subject_id, subject_name, grading_policy_id, percentage, grade, is_pass)
         values (current_tenant_id(), $1, $2, 'Mathematics', $3, $4, $5, $6)`,
        [result.id, SUBJECT_A, GRADING_POLICY_A, percentage, isPass ? 'B' : 'F', isPass],
      ),
    );
    await asHeadmaster(() =>
      conn.query(
        `update student_results
         set average_percentage = $1, subjects_failed_count = $2, overall_pass = $3
         where id = $4`,
        [percentage, isPass ? 0 : 1, isPass, result.id],
      ),
    );
    return result;
  }

  /** Walks a draft result through the full legal path to 'published', as
   * headmaster throughout so this never depends on the scope tests
   * elsewhere in this file. */
  async function publish(service: ResultsService, id: string) {
    await asHeadmaster(() => service.submit(id));
    await asHeadmaster(() => service.review(id));
    await asHeadmaster(() => service.approve(id));
    return asHeadmaster(() => service.publish(id));
  }

  describe('findPublishedForStudent() — FR-RES-040 status filter, deliberately not scoped', () => {
    it('excludes a result until it is actually published, then excludes it again once reopen() supersedes it', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn, false);
        const draft = await createDraftResult(conn, service, STUDENT_A, classId, '75.00', true);

        const beforePublish = await asHeadmaster(() => service.findPublishedForStudent(STUDENT_A));
        expect(beforePublish.find((r) => r.id === draft.id)).toBeUndefined();

        const published = await publish(service, draft.id);
        const afterPublish = await asHeadmaster(() => service.findPublishedForStudent(STUDENT_A));
        expect(afterPublish.map((r) => r.id)).toContain(published.id);
        expect(afterPublish.find((r) => r.id === published.id)!.status).toBe('published');

        const reopened = await asHeadmaster(() => service.reopen(published.id, { reason: 'FR-RES-040 test' } as never));
        resultIds.push(reopened.id);
        const afterReopen = await asHeadmaster(() => service.findPublishedForStudent(STUDENT_A));
        // The old published row is now superseded (excluded); the new row
        // is 'draft' (also excluded) — the student has zero visible results
        // mid-reopen, which is the correct guardian-facing state.
        expect(afterReopen.find((r) => r.id === published.id)).toBeUndefined();
        expect(afterReopen.find((r) => r.id === reopened.id)).toBeUndefined();
      } finally {
        conn.release();
      }
    });

    it('is visible to a scope-restricted caller with no assignment for the class — guardians have no teacher_assignments row at all', async () => {
      const { conn, service } = harness();
      try {
        // Deliberately NOT assigning TEACHER_SUNRISE to this class: proves
        // findPublishedForStudent() doesn't consult scope at all, matching
        // the method's own doc comment ("Deliberately NOT teacher-scoped").
        const classId = await createClass(conn, false);
        const draft = await createDraftResult(conn, service, STUDENT_A, classId, '60.00', true);
        const published = await publish(service, draft.id);

        const asRestrictedCaller = await asScopedTeacher(() => service.findPublishedForStudent(STUDENT_A));
        expect(asRestrictedCaller.map((r) => r.id)).toContain(published.id);
      } finally {
        conn.release();
      }
    });
  });

  describe('findPublishedForStudentAsStaff() — the teacher-scoped counterpart', () => {
    it('hides a published result outside the caller\'s scope, shows it once they are assigned to the class', async () => {
      const { conn, service } = harness();
      try {
        const unassignedClass = await createClass(conn, false);
        const assignedClass = await createClass(conn, true);
        const studentB = await createStudent(conn);

        const inUnassignedClass = await publish(service, (await createDraftResult(conn, service, STUDENT_A, unassignedClass, '55.00', true)).id);
        const inAssignedClass = await publish(service, (await createDraftResult(conn, service, studentB, assignedClass, '65.00', true)).id);

        const hiddenFromScopedTeacher = await asScopedTeacher(() => service.findPublishedForStudentAsStaff(STUDENT_A));
        expect(hiddenFromScopedTeacher.find((r) => r.id === inUnassignedClass.id)).toBeUndefined();

        const visibleToScopedTeacher = await asScopedTeacher(() => service.findPublishedForStudentAsStaff(studentB));
        expect(visibleToScopedTeacher.map((r) => r.id)).toContain(inAssignedClass.id);

        // Unrestricted (headmaster) sees both regardless of assignment.
        const asUnrestricted = await asHeadmaster(() => service.findPublishedForStudentAsStaff(STUDENT_A));
        expect(asUnrestricted.map((r) => r.id)).toContain(inUnassignedClass.id);
      } finally {
        conn.release();
      }
    });
  });

  describe('classAnalytics() — FR-RES-050 (class-average/pass-rate slice)', () => {
    it('404s for a scope-restricted caller with no assignment for the class', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn, false);
        await expect(asScopedTeacher(() => service.classAnalytics(classId, ACADEMIC_YEAR_A))).rejects.toThrow(
          /not found/i,
        );
      } finally {
        conn.release();
      }
    });

    it('computes class_average/pass_rate/student_count from published-or-later results only, excluding drafts', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn, true); // TEACHER_SUNRISE assigned
        const studentB = await createStudent(conn);
        const studentC = await createStudent(conn);

        await publish(service, (await createDraftResult(conn, service, STUDENT_A, classId, '75.00', true)).id);
        await publish(service, (await createDraftResult(conn, service, studentB, classId, '50.00', false)).id);
        // Never published — an outlier value that would visibly skew both
        // figures below if the query didn't filter on status.
        await createDraftResult(conn, service, studentC, classId, '5.00', false);

        const scoped = await asScopedTeacher(() => service.classAnalytics(classId, ACADEMIC_YEAR_A));
        expect(scoped.student_count).toBe('2');
        expect(Number(scoped.class_average)).toBeCloseTo(62.5, 5);
        expect(Number(scoped.pass_rate_percentage)).toBeCloseTo(50, 5);

        const unrestricted = await asHeadmaster(() => service.classAnalytics(classId, ACADEMIC_YEAR_A));
        expect(unrestricted).toEqual(scoped);
      } finally {
        conn.release();
      }
    });
  });
});
