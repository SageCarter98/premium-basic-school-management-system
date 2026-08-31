/**
 * attendance.e2e-spec.ts
 *
 * Chapter 18 (Attendance), FR-ATT-010/011/030 — genuinely untested before
 * this file (no existing suite constructs AttendanceService). The
 * offline-conflict-resolution cycle this file's sync()/resolveConflict()
 * tests exercise was previously only manually live-HTTP verified (see
 * pbsms-platform/README.md's Quick Start), never captured as a repeatable
 * test.
 *
 * FR-ATT-020 (the seven-value status enum) is DTO/HTTP-validation
 * territory (`@IsIn(STATUSES)` in sync-attendance.dto.ts) — this suite
 * bypasses DTO validation entirely by calling the service directly, same
 * as every other suite in this codebase, so there's no service-level
 * behavior to test for it here.
 *
 * Covers:
 *  - FR-ATT-010: sync()'s create path and clientId-keyed idempotent replay.
 *  - FR-ATT-011: same-user last-write-wins by device timestamp (both
 *    directions — a newer entry updates, an older one is superseded), and
 *    a different user on the same key surfaces a conflict rather than
 *    silently overwriting, resolved explicitly via resolveConflict().
 *  - FR-ATT-030: correct() retains the ORIGINAL status across repeated
 *    corrections (coalesce, not overwrite) while updating the current one.
 *
 * Harness pattern copied from results-immutability.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom, same "own
 * class/students per test" and afterAll cleanup discipline. Two distinct
 * actors are used (HEADMASTER, TEACHER_SUNRISE) since FR-ATT-011's
 * same-user-vs-different-user distinction is the whole point under test.
 *
 * Requires a running Postgres with every migration through
 * 0003_attendance.sql (and everything seed_demo.sql needs) already
 * applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { TeacherAssignmentsService } from '../src/modules/teacher-assignments/teacher-assignments.service';

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

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Attendance (Chapter 18 FR-ATT-010/011/030)', () => {
  let pool: Pool;
  const classIds: string[] = [];
  const studentIds: string[] = [];
  const assignmentIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asHeadmaster(async () => {
        await cleanup.query(`delete from teacher_assignments where id = any($1::uuid[])`, [assignmentIds]);
        await cleanup.query(
          `delete from attendance_conflicts where attendance_record_id in (select id from attendance_records where class_id = any($1::uuid[]))`,
          [classIds],
        );
        await cleanup.query(`delete from attendance_records where class_id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: AttendanceService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new AttendanceService(conn, new TeacherAssignmentsService(conn)) };
  }

  async function createClass(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [ACADEMIC_YEAR_A, uniqueName('FR-ATT Class'), 'JHS 2', HEADMASTER],
      ),
    );
    classIds.push(rows[0].id);
    return rows[0].id;
  }

  async function createStudent(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-ATT', 'Fixture', $3, $3) returning id`,
        [SCHOOL_A, uniqueName('ADM'), HEADMASTER],
      ),
    );
    studentIds.push(rows[0].id);
    return rows[0].id;
  }

  async function assignTeacher(conn: WorkerTenantConnection, teacherId: string, classId: string) {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into teacher_assignments (tenant_id, teacher_id, class_id, subject_id, academic_year_id, is_class_teacher, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, true, $5, $5) returning id`,
        [teacherId, classId, SUBJECT_A, ACADEMIC_YEAR_A, HEADMASTER],
      ),
    );
    assignmentIds.push(rows[0].id);
  }

  describe('sync() — FR-ATT-010 create path and idempotent replay', () => {
    it('creates a new record, then replays the identical clientId idempotently rather than duplicating', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const studentId = await createStudent(conn);
        const clientId = uniqueName('client');
        const entry = {
          clientId,
          studentId,
          classId,
          attendanceDate: '2026-09-01',
          status: 'present',
          deviceTimestamp: '2026-09-01T08:00:00.000Z',
        };

        const [created] = await asHeadmaster(() => service.sync([entry] as never));
        expect(created.outcome).toBe('created');

        const [replayed] = await asHeadmaster(() => service.sync([entry] as never));
        expect(replayed.outcome).toBe('idempotent_replay');
        expect((replayed as { record: { id: string } }).record.id).toBe(
          (created as { record: { id: string } }).record.id,
        );

        const all = await asHeadmaster(() =>
          conn.query<{ count: string }>(`select count(*) from attendance_records where class_id = $1`, [classId]),
        );
        expect(all[0].count).toBe('1');
      } finally {
        conn.release();
      }
    });
  });

  describe('sync() — FR-ATT-011 same-user last-write-wins, different-user surfaces a conflict', () => {
    it('a newer device timestamp from the same user updates; an older one is superseded, not applied', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const studentId = await createStudent(conn);
        const base = { studentId, classId, attendanceDate: '2026-09-02' };

        await asHeadmaster(() =>
          service.sync([{ ...base, status: 'present', deviceTimestamp: '2026-09-02T08:00:00.000Z' }] as never),
        );

        const [older] = await asHeadmaster(() =>
          service.sync([{ ...base, status: 'absent', deviceTimestamp: '2026-09-02T07:00:00.000Z' }] as never),
        );
        expect(older.outcome).toBe('superseded');

        const [newer] = await asHeadmaster(() =>
          service.sync([{ ...base, status: 'late', deviceTimestamp: '2026-09-02T09:00:00.000Z' }] as never),
        );
        expect(newer.outcome).toBe('updated');
        expect((newer as { record: { status: string } }).record.status).toBe('late');
      } finally {
        conn.release();
      }
    });

    it('a different user on the same student/date/session is surfaced as a conflict, never silently overwritten, and only applied once resolved', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const studentId = await createStudent(conn);
        await assignTeacher(conn, TEACHER_SUNRISE, classId);
        const base = { studentId, classId, attendanceDate: '2026-09-03' };

        const [original] = await asHeadmaster(() =>
          service.sync([{ ...base, status: 'present', deviceTimestamp: '2026-09-03T08:00:00.000Z' }] as never),
        );
        const originalRecordId = (original as { record: { id: string; status: string } }).record.id;

        const [conflictOutcome] = await asUser(TEACHER_SUNRISE, ['teacher'], () =>
          service.sync([{ ...base, status: 'sick', deviceTimestamp: '2026-09-03T09:00:00.000Z' }] as never),
        );
        expect(conflictOutcome.outcome).toBe('conflict');
        const conflictId = (conflictOutcome as { conflictId: string }).conflictId;

        // Not silently overwritten — the record still shows the original submitter's value.
        const stillOriginal = await asHeadmaster(() => service.findOne(originalRecordId));
        expect(stillOriginal.status).toBe('present');

        const resolved = await asHeadmaster(() => service.resolveConflict(conflictId, 'applied_incoming'));
        expect(resolved.resolved_at).not.toBeNull();
        expect(resolved.resolution).toBe('applied_incoming');

        const afterResolution = await asHeadmaster(() => service.findOne(originalRecordId));
        expect(afterResolution.status).toBe('sick');

        // A conflict can only be resolved once.
        await expect(asHeadmaster(() => service.resolveConflict(conflictId, 'kept_original'))).rejects.toThrow(
          /already resolved/,
        );
      } finally {
        conn.release();
      }
    });
  });

  describe('correct() — FR-ATT-030 retains the original value across repeated corrections', () => {
    it('sets original_status on the first correction and never overwrites it on a later one', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const studentId = await createStudent(conn);
        const [created] = await asHeadmaster(() =>
          service.sync([
            { studentId, classId, attendanceDate: '2026-09-04', status: 'absent', deviceTimestamp: '2026-09-04T08:00:00.000Z' },
          ] as never),
        );
        const recordId = (created as { record: { id: string } }).record.id;

        const firstCorrection = await asHeadmaster(() => service.correct(recordId, 'present', 'Marked absent in error'));
        expect(firstCorrection.status).toBe('present');
        expect(firstCorrection.original_status).toBe('absent');

        const secondCorrection = await asHeadmaster(() => service.correct(recordId, 'late', 'Actually arrived late'));
        expect(secondCorrection.status).toBe('late');
        // Still 'absent' — the value from BEFORE any correction, not from
        // before this second one.
        expect(secondCorrection.original_status).toBe('absent');
      } finally {
        conn.release();
      }
    });
  });
});
