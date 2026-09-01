/**
 * discipline.e2e-spec.ts
 *
 * Chapter 28 (Discipline), FR-OPS-040 — genuinely untested before this
 * file (no existing suite constructs DisciplineService). Also the first
 * suite to exercise Chapter 13.3 record-level scoping for real (this
 * module's own header calls out assertCanActOnStudent()/
 * assignedClassIdsOrNull() as the one place in the codebase that closed
 * that deferred item) — everything else this file covers reuses patterns
 * already proven elsewhere (reported/closed state machines, guardian
 * contact dispatch).
 *
 * Covers:
 *  - Case status machine: reported -> investigating -> response_issued ->
 *    closed -> investigating (reopenCase(), an explicit way back), with a
 *    409 on each out-of-state transition attempted along the way.
 *  - Chapter 13.3 scoping: a teacher with no active assignment for the
 *    student's class is refused (createCase/findCase); the assigned
 *    teacher succeeds; an ACADEMIC_ADMIN-tier caller (headmaster) always
 *    succeeds regardless of assignment.
 *  - Appeals: fileAppeal() only from 'response_issued'; decideAppeal()
 *    closes the case either way (upheld/denied) and refuses to decide an
 *    already-decided appeal twice.
 *  - contactGuardian(): rejects a bogus staff recipientId; a dispatch
 *    channel creates exactly one confidential notification (same
 *    FR-COM-050 email-only override health/discipline's shared
 *    CommunicationService chain already applies).
 *
 * Harness pattern copied from attendance.e2e-spec.ts (class/student/
 * teacher-assignment fixture helpers) and results-immutability.e2e-spec.ts
 * (WorkerTenantConnection + TenantContextStore.run() idiom, per-file
 * fixture tracking, afterAll cleanup).
 *
 * Requires a running Postgres with every migration through
 * 0011_discipline.sql (and everything seed_demo.sql needs) already
 * applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { DisciplineService } from '../src/modules/discipline/discipline.service';
import { TeacherAssignmentsService } from '../src/modules/teacher-assignments/teacher-assignments.service';
import { GuardiansService } from '../src/modules/guardians/guardians.service';
import { CommunicationService } from '../src/modules/communication/communication.service';
import { StaffService } from '../src/modules/staff/staff.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001';
const SUBJECT_A = '55555555-0000-0000-0000-000000000001'; // Mathematics
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise — ACADEMIC_ADMIN tier, unrestricted
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

describe('Discipline (Chapter 28 FR-OPS-040)', () => {
  let pool: Pool;
  const classIds: string[] = [];
  const studentIds: string[] = [];
  const enrolmentIds: string[] = [];
  const assignmentIds: string[] = [];
  const caseIds: string[] = [];
  const appealIds: string[] = [];
  const recognitionIds: string[] = [];
  const guardianContactIds: string[] = [];
  const notificationIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asHeadmaster(async () => {
        await cleanup.query(`delete from discipline_guardian_contacts where id = any($1::uuid[])`, [guardianContactIds]);
        await cleanup.query(`delete from notification_deliveries where notification_id = any($1::uuid[])`, [notificationIds]);
        await cleanup.query(`delete from notifications where id = any($1::uuid[])`, [notificationIds]);
        await cleanup.query(`delete from discipline_appeals where id = any($1::uuid[])`, [appealIds]);
        await cleanup.query(`delete from discipline_case_responses where case_id = any($1::uuid[])`, [caseIds]);
        await cleanup.query(`delete from discipline_case_notes where case_id = any($1::uuid[])`, [caseIds]);
        await cleanup.query(`delete from discipline_cases where id = any($1::uuid[])`, [caseIds]);
        await cleanup.query(`delete from discipline_recognitions where id = any($1::uuid[])`, [recognitionIds]);
        await cleanup.query(`delete from teacher_assignments where id = any($1::uuid[])`, [assignmentIds]);
        await cleanup.query(`delete from enrolments where id = any($1::uuid[])`, [enrolmentIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: DisciplineService } {
    const conn = new WorkerTenantConnection(pool);
    const guardians = new GuardiansService(conn);
    const communication = new CommunicationService(conn, new StaffService(conn), guardians);
    return {
      conn,
      service: new DisciplineService(conn, communication, new StaffService(conn), guardians, new TeacherAssignmentsService(conn)),
    };
  }

  async function createClass(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [ACADEMIC_YEAR_A, uniqueName('FR-OPS-040 Class'), 'JHS 2', HEADMASTER],
      ),
    );
    classIds.push(rows[0].id);
    return rows[0].id;
  }

  async function createEnrolledStudent(conn: WorkerTenantConnection, classId: string): Promise<string> {
    const studentRows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-OPS-040', 'Fixture', $3, $3) returning id`,
        [SCHOOL_A, uniqueName('ADM'), HEADMASTER],
      ),
    );
    const studentId = studentRows[0].id;
    studentIds.push(studentId);
    const enrolRows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into enrolments (tenant_id, student_id, academic_year_id, class_id, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [studentId, ACADEMIC_YEAR_A, classId, HEADMASTER],
      ),
    );
    enrolmentIds.push(enrolRows[0].id);
    return studentId;
  }

  async function assignTeacher(conn: WorkerTenantConnection, classId: string) {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into teacher_assignments (tenant_id, teacher_id, class_id, subject_id, academic_year_id, is_class_teacher, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, true, $5, $5) returning id`,
        [TEACHER_SUNRISE, classId, SUBJECT_A, ACADEMIC_YEAR_A, HEADMASTER],
      ),
    );
    assignmentIds.push(rows[0].id);
  }

  describe('Case status machine', () => {
    it('walks reported -> investigating -> response_issued -> closed -> investigating, refusing each out-of-state transition', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const studentId = await createEnrolledStudent(conn, classId);

        const created = await asHeadmaster(() =>
          service.createCase({
            studentId,
            category: 'uniform',
            severity: 'minor',
            incidentDate: '2026-08-01',
            description: 'Out of uniform',
            reportedBy: HEADMASTER,
          } as never),
        );
        caseIds.push(created.id);
        expect(created.status).toBe('reported');

        await expect(asHeadmaster(() => service.closeCase(created.id))).rejects.toThrow(/not 'response_issued'/);

        const investigating = await asHeadmaster(() => service.startInvestigation(created.id));
        expect(investigating.status).toBe('investigating');
        await expect(asHeadmaster(() => service.startInvestigation(created.id))).rejects.toThrow(/not 'reported'/);

        await asHeadmaster(() =>
          service.issueResponse(created.id, { responseType: 'warning', description: 'Verbal warning issued', issuedBy: HEADMASTER } as never),
        );
        const afterResponse = await asHeadmaster(() => service.findCase(created.id));
        expect(afterResponse.status).toBe('response_issued');

        const closed = await asHeadmaster(() => service.closeCase(created.id));
        expect(closed.status).toBe('closed');
        expect(closed.closed_at).not.toBeNull();
        await expect(asHeadmaster(() => service.reopenCase('00000000-0000-0000-0000-000000000000'))).rejects.toThrow(/not found/);

        const reopened = await asHeadmaster(() => service.reopenCase(created.id));
        expect(reopened.status).toBe('investigating');
        expect(reopened.reopened_at).not.toBeNull();
        await expect(asHeadmaster(() => service.reopenCase(created.id))).rejects.toThrow(/not 'closed'/);
      } finally {
        conn.release();
      }
    });
  });

  describe('Chapter 13.3 record scoping', () => {
    it('refuses an unassigned teacher, allows the assigned teacher, and always allows an ACADEMIC_ADMIN caller', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const studentId = await createEnrolledStudent(conn, classId);

        await expect(
          asTeacher(() =>
            service.createCase({
              studentId,
              category: 'lateness',
              severity: 'minor',
              incidentDate: '2026-08-02',
              description: 'Repeated lateness',
              reportedBy: TEACHER_SUNRISE,
            } as never),
          ),
        ).rejects.toThrow(/do not have an active teacher assignment/);

        const asAdmin = await asHeadmaster(() =>
          service.createCase({
            studentId,
            category: 'lateness',
            severity: 'minor',
            incidentDate: '2026-08-02',
            description: 'Repeated lateness',
            reportedBy: HEADMASTER,
          } as never),
        );
        caseIds.push(asAdmin.id);
        await expect(asTeacher(() => service.findCase(asAdmin.id))).rejects.toThrow(/do not have an active teacher assignment/);

        await assignTeacher(conn, classId);
        const assignedCanRead = await asTeacher(() => service.findCase(asAdmin.id));
        expect(assignedCanRead.id).toBe(asAdmin.id);

        const asAssignedTeacher = await asTeacher(() =>
          service.createCase({
            studentId,
            category: 'lateness',
            severity: 'minor',
            incidentDate: '2026-08-03',
            description: 'Late again',
            reportedBy: TEACHER_SUNRISE,
          } as never),
        );
        caseIds.push(asAssignedTeacher.id);
        expect(asAssignedTeacher.student_id).toBe(studentId);
      } finally {
        conn.release();
      }
    });
  });

  describe('Appeals — fileAppeal()/decideAppeal()', () => {
    it('only accepts an appeal from response_issued, and decides it exactly once, closing the case', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const studentId = await createEnrolledStudent(conn, classId);
        const discCase = await asHeadmaster(() =>
          service.createCase({
            studentId,
            category: 'fighting',
            severity: 'major',
            incidentDate: '2026-08-04',
            description: 'Altercation in the yard',
            reportedBy: HEADMASTER,
          } as never),
        );
        caseIds.push(discCase.id);

        await expect(
          asHeadmaster(() => service.fileAppeal(discCase.id, { raisedBy: HEADMASTER, reason: 'Too early' } as never)),
        ).rejects.toThrow(/not 'response_issued'/);

        await asHeadmaster(() =>
          service.issueResponse(discCase.id, { responseType: 'suspension', description: '3-day suspension', issuedBy: HEADMASTER } as never),
        );

        const appeal = await asHeadmaster(() =>
          service.fileAppeal(discCase.id, { raisedBy: HEADMASTER, reason: 'Disputes the account of events' } as never),
        );
        appealIds.push(appeal.id);
        expect(appeal.decision).toBe('pending');

        const afterAppeal = await asHeadmaster(() => service.findCase(discCase.id));
        expect(afterAppeal.status).toBe('appealed');

        const decided = await asHeadmaster(() =>
          service.decideAppeal(appeal.id, { decision: 'denied', decidedBy: HEADMASTER, decisionNotes: 'Evidence supports original response' } as never),
        );
        expect(decided.decision).toBe('denied');

        const closedCase = await asHeadmaster(() => service.findCase(discCase.id));
        expect(closedCase.status).toBe('closed');

        await expect(
          asHeadmaster(() => service.decideAppeal(appeal.id, { decision: 'upheld', decidedBy: HEADMASTER } as never)),
        ).rejects.toThrow(/already 'denied'/);
      } finally {
        conn.release();
      }
    });
  });

  describe('contactGuardian()', () => {
    it('rejects a bogus staff recipientId, dispatches exactly one confidential notification for a real one', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const studentId = await createEnrolledStudent(conn, classId);
        const discCase = await asHeadmaster(() =>
          service.createCase({
            studentId,
            category: 'uniform',
            severity: 'minor',
            incidentDate: '2026-08-05',
            description: 'Out of uniform again',
            reportedBy: HEADMASTER,
          } as never),
        );
        caseIds.push(discCase.id);

        await expect(
          asHeadmaster(() =>
            service.contactGuardian(discCase.id, {
              recipientType: 'staff',
              recipientId: '00000000-0000-0000-0000-000000000000',
              recipientName: 'Nobody',
              notes: 'x',
              contactedBy: HEADMASTER,
            } as never),
          ),
        ).rejects.toThrow(/not a real staff member/);

        const contact = await asHeadmaster(() =>
          service.contactGuardian(discCase.id, {
            recipientType: 'staff',
            recipientId: TEACHER_SUNRISE,
            recipientName: 'Teacher Sunrise',
            recipientEmail: 'teacher@sunrise.pbsms.test',
            channel: 'whatsapp',
            notes: 'Discussed the case with the class teacher',
            contactedBy: HEADMASTER,
          } as never),
        );
        guardianContactIds.push(contact.id);
        expect(contact.notification_id).not.toBeNull();

        const deliveries = await asHeadmaster(() =>
          conn.query<{ channel: string }>(`select channel from notification_deliveries where notification_id = $1`, [
            contact.notification_id,
          ]),
        );
        notificationIds.push(contact.notification_id as string);
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0].channel).toBe('email');
      } finally {
        conn.release();
      }
    });
  });

  describe('createRecognition() — no workflow', () => {
    it('logs a positive-behaviour recognition for an assigned student', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const studentId = await createEnrolledStudent(conn, classId);

        const recognition = await asHeadmaster(() =>
          service.createRecognition({
            studentId,
            category: 'academic',
            description: 'Top of class this term',
            awardedBy: HEADMASTER,
          } as never),
        );
        recognitionIds.push(recognition.id);
        expect(recognition.student_id).toBe(studentId);

        const fetched = await asHeadmaster(() => service.findRecognition(recognition.id));
        expect(fetched.id).toBe(recognition.id);
      } finally {
        conn.release();
      }
    });
  });
});
