/**
 * analytics.e2e-spec.ts
 *
 * Chapter 14 (Operational Intelligence Framework), FR-ANL-010/020/040 —
 * genuinely untested before this file (no existing suite constructs
 * AnalyticsService).
 *
 * FR-ANL-040 ("configurable, auditable AI-assisted summarization of
 * trends and draft recommendations") is deliberately NOT covered here —
 * 0028_analytics.sql's own header states it is genuinely unimplemented
 * (the SRS itself frames it as aspirational future scope, and there is
 * no LLM/AI provider integration anywhere in this codebase to wrap). A
 * requirement with no implementation is a Stage-4/EC-104 build decision,
 * not an EC-107 test-writing gap — flagged rather than faked.
 *
 * Covers:
 *  - trendsByStudent() — FR-ANL-020: two published results for the same
 *    student across two different academic years (a fresh academic_years
 *    fixture, same pattern students.e2e-spec.ts uses, since seed_demo.sql
 *    only seeds one year for Tenant A) come back ordered ascending by
 *    year with the correct percentages — the actual "term-over-term/
 *    year-over-year trend" the requirement text names.
 *  - groupRollup() — FR-ANL-010: a second school for Tenant A (proving
 *    the "where a tenant contains more than one school" half of the
 *    requirement text for real, not with the single seeded school) shows
 *    up in the roll-up with a real academicPerformance figure once a
 *    published result exists for it, and collectionRate/attendanceRate
 *    default to 0 rather than erroring when no finance/attendance data
 *    exists for that school yet.
 *
 * Harness pattern copied from documents.e2e-spec.ts (ResultsService +
 * TeacherAssignmentsService for the draft-then-publish result fixture).
 *
 * Requires a running Postgres with every migration through
 * 0028_analytics.sql (and seed_demo.sql) applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';
import { StaffService } from '../src/modules/staff/staff.service';
import { ResultsService } from '../src/modules/results/results.service';
import { TeacherAssignmentsService } from '../src/modules/teacher-assignments/teacher-assignments.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SUBJECT_A = '55555555-0000-0000-0000-000000000001'; // Mathematics
const GRADING_POLICY_A = 'a0000000-0000-0000-0000-000000000001';
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

function asHeadmaster<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Analytics (Chapter 14, FR-ANL-010/020)', () => {
  let pool: Pool;
  const studentIds: string[] = [];
  const classIds: string[] = [];
  const resultIds: string[] = [];
  const academicYearIds: string[] = [];
  const schoolIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asHeadmaster(async () => {
        await cleanup.query(`delete from student_result_items where student_result_id = any($1::uuid[])`, [resultIds]);
        await cleanup.query(`delete from student_results where id = any($1::uuid[])`, [resultIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from academic_years where id = any($1::uuid[])`, [academicYearIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
        await cleanup.query(`delete from schools where id = any($1::uuid[])`, [schoolIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: AnalyticsService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new AnalyticsService(conn, new StaffService(conn)) };
  }

  async function createSchool(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into schools (tenant_id, name, code, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $3) returning id`,
        [uniqueName('FR-ANL School'), uniqueName('SCH'), HEADMASTER],
      ),
    );
    schoolIds.push(rows[0].id);
    return rows[0].id;
  }

  async function createClass(conn: WorkerTenantConnection, schoolId: string, academicYearId: string): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [academicYearId, uniqueName('FR-ANL Class'), 'JHS 2', HEADMASTER],
      ),
    );
    classIds.push(rows[0].id);
    return rows[0].id;
  }

  /** start_date/end_date set explicitly -- computeAcademicPerformance()'s
   * period filter (`ay.start_date <= periodEnd and (end_date is null or
   * end_date >= periodStart)`) excludes a row with a null start_date
   * entirely, unlike the seeded academic years which already have real
   * dates. */
  async function createAcademicYear(conn: WorkerTenantConnection, schoolId: string, startDate: string): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into academic_years (tenant_id, school_id, name, status, start_date, end_date, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'active', $3, $4, $5, $5) returning id`,
        [schoolId, uniqueName('FR-ANL Year'), startDate, `${Number(startDate.slice(0, 4)) + 1}-07-31`, HEADMASTER],
      ),
    );
    academicYearIds.push(rows[0].id);
    return rows[0].id;
  }

  async function createStudent(conn: WorkerTenantConnection, schoolId: string): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-ANL', 'Fixture', $3, $3) returning id`,
        [schoolId, uniqueName('ADM'), HEADMASTER],
      ),
    );
    studentIds.push(rows[0].id);
    return rows[0].id;
  }

  /** Draft-then-publish a result with one snapshotted item, same shortcut
   * documents.e2e-spec.ts / results-visibility.e2e-spec.ts use. */
  async function createPublishedResult(
    conn: WorkerTenantConnection,
    studentId: string,
    classId: string,
    academicYearId: string,
    percentage: string,
  ) {
    const results = new ResultsService(conn, new TeacherAssignmentsService(conn));
    const result = await asHeadmaster(() => results.create({ studentId, classId, academicYearId } as never));
    resultIds.push(result.id);
    await asHeadmaster(() =>
      conn.query(
        `insert into student_result_items
           (tenant_id, student_result_id, subject_id, subject_name, grading_policy_id, percentage, grade, is_pass)
         values (current_tenant_id(), $1, $2, 'Mathematics', $3, $4, 'A', true)`,
        [result.id, SUBJECT_A, GRADING_POLICY_A, percentage],
      ),
    );
    await asHeadmaster(() =>
      conn.query(
        `update student_results set average_percentage = $2, subjects_failed_count = 0, overall_pass = true where id = $1`,
        [result.id, percentage],
      ),
    );
    await asHeadmaster(() => results.submit(result.id));
    await asHeadmaster(() => results.review(result.id));
    await asHeadmaster(() => results.approve(result.id));
    return asHeadmaster(() => results.publish(result.id));
  }

  it('trendsByStudent() returns two academic years, ordered ascending, with the correct percentages', async () => {
    const { conn, service } = harness();
    try {
      const studentId = await createStudent(conn, SCHOOL_A);
      // Both years created as fresh fixtures with explicit start_dates --
      // the seeded ACADEMIC_YEAR_A has a null start_date (confirmed
      // directly against seed_demo.sql), which order-by-start_date-asc
      // sorts last, not chronologically, so it can't stand in for "the
      // earlier year" here.
      const year1 = await createAcademicYear(conn, SCHOOL_A, '2025-09-01');
      const classYear1 = await createClass(conn, SCHOOL_A, year1);
      await createPublishedResult(conn, studentId, classYear1, year1, '65.00');

      const year2 = await createAcademicYear(conn, SCHOOL_A, '2027-09-01');
      const classYear2 = await createClass(conn, SCHOOL_A, year2);
      await createPublishedResult(conn, studentId, classYear2, year2, '78.00');

      const trend = await asHeadmaster(() => service.trendsByStudent(studentId));
      expect(trend).toHaveLength(2);
      expect(trend[0].averagePercentage).toBe('65.00');
      expect(trend[1].averagePercentage).toBe('78.00');
    } finally {
      conn.release();
    }
  });

  it('groupRollup() includes a second school, with a real academicPerformance figure and 0 for finance/attendance with no data', async () => {
    const { conn, service } = harness();
    try {
      const schoolId = await createSchool(conn);
      const academicYearId = await createAcademicYear(conn, schoolId, '2026-09-01');
      const classId = await createClass(conn, schoolId, academicYearId);
      const studentId = await createStudent(conn, schoolId);
      await createPublishedResult(conn, studentId, classId, academicYearId, '90.00');

      const rollup = await asHeadmaster(() => service.groupRollup('2020-01-01', '2030-12-31'));
      const entry = rollup.schools.find((s) => s.schoolId === schoolId);
      expect(entry).toBeDefined();
      expect(entry!.academicPerformance).toBe(90);
      expect(entry!.collectionRate).toBe(0);
      expect(entry!.attendanceRate).toBe(0);
    } finally {
      conn.release();
    }
  });
});
