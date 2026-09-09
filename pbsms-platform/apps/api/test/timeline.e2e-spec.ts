/**
 * timeline.e2e-spec.ts
 *
 * FR-STU-050 (spec §7.5, Student Profile's Timeline tab): "a chronological
 * student timeline (timestamp/actor/module/description per event)."
 * TimelineService cited this ID in its own header before this file
 * existed -- detect-spec-gaps.ts correctly flagged it "referenced but
 * untested." No suite had ever constructed TimelineService.
 *
 * Covers the two real properties the requirement text and this service's
 * own header both name:
 *  - Category-level access gating (not just "can view this student"): a
 *    caller with only ACADEMIC_STAFF tier (academic_coordinator) sees
 *    attendance/discipline/result events but never finance or health ones, even
 *    when that data genuinely exists for the student -- categories are
 *    silently omitted, not partially redacted or 403'd. A finance-only
 *    caller (accountant) and a health-only caller (health_officer) each
 *    see exactly their one category and nothing else, proving the gate
 *    is genuinely per-category rather than "staff sees everything."
 *  - Chronological merge across every category, most-recent-first, for a
 *    caller with all three tiers (headmaster, LEADERSHIP-tier -- in
 *    ACADEMIC_ADMIN/FINANCE_READERS/HEALTH_READERS at once) -- proving
 *    getTimeline() actually merges and sorts events from five different
 *    services' tables rather than just concatenating them in call order.
 *    Also covers the one filtering rule inside the attendance branch
 *    itself: a 'present' mark is never surfaced as an event at all
 *    (only exceptions are timeline-worthy), alongside an 'absent' mark
 *    for the same student that IS surfaced.
 *
 * The result and payment fixtures both land at "now" (results.publish()
 * and payments.received_at's own DB default respectively) -- close
 * enough together that asserting their relative order to each other
 * would be flaky. The sort assertion instead checks each of their
 * positions is before every explicitly-past-dated event, not the exact
 * full array order.
 *
 * Harness pattern copied from discipline.e2e-spec.ts (WorkerTenantConnection
 * + TenantContextStore.run() idiom, CommunicationService/StaffService/
 * GuardiansService wiring) and analytics.e2e-spec.ts (the draft-submit-
 * review-approve-publish result-fixture helper).
 *
 * Requires a running Postgres with every migration through
 * 0028_analytics.sql (and seed_demo.sql) applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { TimelineService } from '../src/modules/timeline/timeline.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { ResultsService } from '../src/modules/results/results.service';
import { DisciplineService } from '../src/modules/discipline/discipline.service';
import { HealthService } from '../src/modules/health/health.service';
import { FinanceService } from '../src/modules/finance/finance.service';
import { TeacherAssignmentsService } from '../src/modules/teacher-assignments/teacher-assignments.service';
import { GuardiansService } from '../src/modules/guardians/guardians.service';
import { CommunicationService } from '../src/modules/communication/communication.service';
import { StaffService } from '../src/modules/staff/staff.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SUBJECT_A = '55555555-0000-0000-0000-000000000001'; // Mathematics
const GRADING_POLICY_A = 'a0000000-0000-0000-0000-000000000001';
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise -- LEADERSHIP tier, sees every category

// These roles never write anything under this file (getTimeline() is
// read-only), so the userId attached to them never needs to resolve to a
// real users row -- only .roles is read by the per-category gates below.
//
// ACADEMIC_STAFF_ONLY deliberately uses 'academic_coordinator', not
// 'teacher' -- TeacherAssignmentsService.getCallerScope() only applies
// Chapter 13.3 class-assignment scoping to a caller whose roles are
// EXACTLY ['teacher'] (isPureTeacher); every other tier, including
// academic_coordinator, is unrestricted. A real unassigned 'teacher'
// would see nothing at all here regardless of category gating, which
// would test 13.3 scoping instead of FR-STU-050's category gate -- not
// what this file is verifying.
const ACADEMIC_STAFF_ONLY = { userId: '99999999-0000-0000-0000-000000000090', roles: ['academic_coordinator'] };
const ACCOUNTANT_ONLY = { userId: '99999999-0000-0000-0000-000000000091', roles: ['accountant'] };
const HEALTH_OFFICER_ONLY = { userId: '99999999-0000-0000-0000-000000000092', roles: ['health_officer'] };

function asHeadmaster<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}
function asRole<T>(actor: { userId: string; roles: string[] }, fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: actor.userId, roles: actor.roles, isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Timeline (Chapter 7.5, FR-STU-050)', () => {
  let pool: Pool;
  const studentIds: string[] = [];
  const classIds: string[] = [];
  const academicYearIds: string[] = [];
  const resultIds: string[] = [];
  const attendanceIds: string[] = [];
  const disciplineCaseIds: string[] = [];
  const healthIncidentIds: string[] = [];
  const paymentIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asHeadmaster(async () => {
        await cleanup.query(`delete from payments where id = any($1::uuid[])`, [paymentIds]);
        await cleanup.query(`delete from health_incidents where id = any($1::uuid[])`, [healthIncidentIds]);
        await cleanup.query(`delete from discipline_cases where id = any($1::uuid[])`, [disciplineCaseIds]);
        await cleanup.query(`delete from attendance_records where id = any($1::uuid[])`, [attendanceIds]);
        await cleanup.query(`delete from student_result_items where student_result_id = any($1::uuid[])`, [resultIds]);
        await cleanup.query(`delete from student_results where id = any($1::uuid[])`, [resultIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from academic_years where id = any($1::uuid[])`, [academicYearIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(conn: WorkerTenantConnection) {
    const teacherAssignments = new TeacherAssignmentsService(conn);
    const guardians = new GuardiansService(conn);
    const staff = new StaffService(conn);
    const communication = new CommunicationService(conn, staff, guardians);
    const attendance = new AttendanceService(conn, teacherAssignments);
    const results = new ResultsService(conn, teacherAssignments);
    const discipline = new DisciplineService(conn, communication, staff, guardians, teacherAssignments);
    const health = new HealthService(conn, communication, staff, guardians);
    const finance = new FinanceService(conn);
    const timeline = new TimelineService(attendance, results, discipline, health, finance);
    return { attendance, results, discipline, health, finance, timeline };
  }

  async function createAcademicYear(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into academic_years (tenant_id, school_id, name, status, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'active', $3, $3) returning id`,
        [SCHOOL_A, uniqueName('FR-STU-050 Year'), HEADMASTER],
      ),
    );
    academicYearIds.push(rows[0].id);
    return rows[0].id;
  }

  async function createClass(conn: WorkerTenantConnection, academicYearId: string): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [academicYearId, uniqueName('FR-STU-050 Class'), 'JHS 2', HEADMASTER],
      ),
    );
    classIds.push(rows[0].id);
    return rows[0].id;
  }

  async function createStudent(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-STU-050', 'Fixture', $3, $3) returning id`,
        [SCHOOL_A, uniqueName('ADM'), HEADMASTER],
      ),
    );
    studentIds.push(rows[0].id);
    return rows[0].id;
  }

  /** Draft-then-publish a result, same shortcut analytics.e2e-spec.ts /
   * documents.e2e-spec.ts use. published_at lands at "now". */
  async function publishResult(
    conn: WorkerTenantConnection,
    results: ResultsService,
    studentId: string,
    classId: string,
    academicYearId: string,
  ) {
    const result = await asHeadmaster(() => results.create({ studentId, classId, academicYearId } as never));
    resultIds.push(result.id);
    await asHeadmaster(() =>
      conn.query(
        `insert into student_result_items
           (tenant_id, student_result_id, subject_id, subject_name, grading_policy_id, percentage, grade, is_pass)
         values (current_tenant_id(), $1, $2, 'Mathematics', $3, 75, 'B', true)`,
        [result.id, SUBJECT_A, GRADING_POLICY_A],
      ),
    );
    await asHeadmaster(() =>
      conn.query(
        `update student_results set average_percentage = 75, subjects_failed_count = 0, overall_pass = true where id = $1`,
        [result.id],
      ),
    );
    await asHeadmaster(() => results.submit(result.id));
    await asHeadmaster(() => results.review(result.id));
    await asHeadmaster(() => results.approve(result.id));
    return asHeadmaster(() => results.publish(result.id));
  }

  async function markAttendance(conn: WorkerTenantConnection, studentId: string, classId: string, date: string, status: string) {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into attendance_records (tenant_id, student_id, class_id, attendance_date, status, client_id, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $6) returning id`,
        [studentId, classId, date, status, uniqueName('client'), HEADMASTER],
      ),
    );
    attendanceIds.push(rows[0].id);
  }

  it('an ACADEMIC_STAFF-only caller (academic_coordinator) sees attendance/discipline/result events but never finance or health, even though that data exists for this student', async () => {
    const conn = new WorkerTenantConnection(pool);
    try {
      const { results, discipline, health, finance, timeline } = harness(conn);
      const academicYearId = await createAcademicYear(conn);
      const classId = await createClass(conn, academicYearId);
      const studentId = await createStudent(conn);

      await markAttendance(conn, studentId, classId, '2020-01-10', 'absent');
      const created = await asHeadmaster(() =>
        discipline.createCase({
          studentId,
          category: 'uniform',
          severity: 'minor',
          incidentDate: '2020-02-01',
          description: 'Out of uniform',
          reportedBy: HEADMASTER,
        } as never),
      );
      disciplineCaseIds.push((created as { id: string }).id);
      const incident = await asHeadmaster(() =>
        health.createIncident({ studentId, incidentDate: '2020-03-01', description: 'Headache', severity: 'minor' } as never),
      );
      healthIncidentIds.push((incident as { id: string }).id);
      const payment = await asHeadmaster(() =>
        finance.recordPayment({ studentId, method: 'cash', amount: 100 } as never),
      );
      paymentIds.push((payment as { id: string }).id);
      await publishResult(conn, results, studentId, classId, academicYearId);

      const events = await asRole(ACADEMIC_STAFF_ONLY, () => timeline.getTimeline(studentId));
      const types = new Set(events.map((e) => e.type));
      expect(types).toEqual(new Set(['attendance', 'discipline', 'result']));
    } finally {
      conn.release();
    }
  });

  it('a finance-only caller (accountant) sees exactly the finance events and nothing else', async () => {
    const conn = new WorkerTenantConnection(pool);
    try {
      const { finance, timeline } = harness(conn);
      const academicYearId = await createAcademicYear(conn);
      const classId = await createClass(conn, academicYearId);
      const studentId = await createStudent(conn);
      await markAttendance(conn, studentId, classId, '2020-01-10', 'absent');
      const payment = await asHeadmaster(() =>
        finance.recordPayment({ studentId, method: 'cash', amount: 250 } as never),
      );
      paymentIds.push((payment as { id: string }).id);

      const events = await asRole(ACCOUNTANT_ONLY, () => timeline.getTimeline(studentId));
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('finance');
    } finally {
      conn.release();
    }
  });

  it('a health-only caller (health_officer) sees exactly the health events and nothing else', async () => {
    const conn = new WorkerTenantConnection(pool);
    try {
      const { health, timeline } = harness(conn);
      const academicYearId = await createAcademicYear(conn);
      const classId = await createClass(conn, academicYearId);
      const studentId = await createStudent(conn);
      await markAttendance(conn, studentId, classId, '2020-01-10', 'absent');
      const incident = await asHeadmaster(() =>
        health.createIncident({ studentId, incidentDate: '2020-03-01', description: 'Fever', severity: 'moderate' } as never),
      );
      healthIncidentIds.push((incident as { id: string }).id);

      const events = await asRole(HEALTH_OFFICER_ONLY, () => timeline.getTimeline(studentId));
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('health');
    } finally {
      conn.release();
    }
  });

  it('a caller with every tier (headmaster) sees a chronological, most-recent-first merge across all five categories, excluding present marks', async () => {
    const conn = new WorkerTenantConnection(pool);
    try {
      const { results, discipline, health, finance, timeline } = harness(conn);
      const academicYearId = await createAcademicYear(conn);
      const classId = await createClass(conn, academicYearId);
      const studentId = await createStudent(conn);

      await markAttendance(conn, studentId, classId, '2020-01-10', 'absent');
      await markAttendance(conn, studentId, classId, '2020-01-11', 'present'); // never surfaced
      const created = await asHeadmaster(() =>
        discipline.createCase({
          studentId,
          category: 'uniform',
          severity: 'minor',
          incidentDate: '2020-02-01',
          description: 'Out of uniform',
          reportedBy: HEADMASTER,
        } as never),
      );
      disciplineCaseIds.push((created as { id: string }).id);
      const incident = await asHeadmaster(() =>
        health.createIncident({ studentId, incidentDate: '2020-03-01', description: 'Headache', severity: 'minor' } as never),
      );
      healthIncidentIds.push((incident as { id: string }).id);
      const payment = await asHeadmaster(() =>
        finance.recordPayment({ studentId, method: 'cash', amount: 100 } as never),
      );
      paymentIds.push((payment as { id: string }).id);
      await publishResult(conn, results, studentId, classId, academicYearId);

      const events = await asHeadmaster(() => timeline.getTimeline(studentId));

      // 5 real events (attendance-absent, discipline, health, finance,
      // result) -- the 'present' mark creates a 6th attendance_records
      // row but is filtered out entirely, never becoming an event.
      expect(events).toHaveLength(5);
      expect(events.some((e) => e.type === 'attendance' && e.summary.includes('present'))).toBe(false);

      const indexOf = (type: string) => events.findIndex((e) => e.type === type);
      // result/finance both land at "now" -- their relative order to each
      // other isn't asserted, only that both precede every explicitly
      // past-dated event.
      expect(indexOf('result')).toBeLessThan(indexOf('health'));
      expect(indexOf('finance')).toBeLessThan(indexOf('health'));
      expect(indexOf('health')).toBeLessThan(indexOf('discipline'));
      expect(indexOf('discipline')).toBeLessThan(indexOf('attendance'));
    } finally {
      conn.release();
    }
  });
});
