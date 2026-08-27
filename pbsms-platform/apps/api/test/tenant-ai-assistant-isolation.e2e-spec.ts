/**
 * tenant-ai-assistant-isolation.e2e-spec.ts
 *
 * Chapter 47 (Tenant AI Assistant) stage 1's isolation and grounding gate
 * (§47.0.2, TEN-054). Becomes an EC-400 protected suite the moment it's
 * merged — see CLAUDE.md, which already reserved this slot before this
 * file existed. Authored under EC-005's 2026-08-27 amendment (two-approver
 * review, one holding Chapter-47/AI domain ownership) — see CLAUDE.md's
 * "Protected zones" section for that posture; once merged, this Agent may
 * add new cases in a PR touching nothing else, never modify or delete an
 * existing one, exactly as finance-invariants.e2e-spec.ts and
 * results-immutability.e2e-spec.ts already establish that pattern.
 *
 * This is deliberately NOT a re-test of RLS itself (tenant-isolation
 * .e2e-spec.ts's job) — it tests the TypeScript-level scope/DP-100/
 * impersonation/settings logic in assistant-retrieval.service.ts that RLS
 * has nothing to say about, plus FR-AIT-011/012 response-shape guarantees.
 *
 * Harness: same WorkerTenantConnection + TenantContextStore.run() idiom as
 * finance-invariants.e2e-spec.ts and results-immutability.e2e-spec.ts —
 * AssistantRetrievalService takes a Scope.REQUEST TenantDatabaseService, so
 * it's constructed directly against a WorkerTenantConnection rather than
 * through Nest's DI container.
 *
 * Cleanup discipline matters more here than usual: tenant-isolation
 * .e2e-spec.ts asserts `select id from attendance_records` for Tenant A
 * returns exactly ONE row (the seeded fixture) — any attendance_records
 * row this file creates and fails to delete in `afterAll` breaks that
 * unrelated suite's exact-count assertion, the same failure mode
 * finance-invariants.e2e-spec.ts's own header already warns about. Every
 * class, student, teacher_assignments row, and attendance_records row
 * created here is tracked and deleted, in FK-safe order.
 *
 * Requires a running Postgres with every migration through
 * 0049_assistant_interactions.sql and seed_demo.sql already applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContext, TenantContextStore } from '../src/common/tenant/tenant-context';
import { TeacherAssignmentsService } from '../src/modules/teacher-assignments/teacher-assignments.service';
import { assertCategoryAllowed } from '../src/modules/tenant-ai-assistant/assistant-categories';
import { AssistantInteractionLogger } from '../src/modules/tenant-ai-assistant/assistant-interaction-logger.service';
import { AssistantRetrievalService } from '../src/modules/tenant-ai-assistant/assistant-retrieval.service';
import { AssistantSettingsService } from '../src/modules/tenant-ai-assistant/assistant-settings.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const TENANT_B = '22222222-2222-2222-2222-222222222222'; // Golden Gate Schools Group
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001';
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise
const TEACHER = '99999999-0000-0000-0000-000000000003'; // teacher@sunrise — seeded assigned to dddddddd-0000-0000-0000-000000000001 only

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ctx(overrides: Pick<TenantContext, 'tenantId' | 'userId' | 'roles'> & Partial<TenantContext>): TenantContext {
  return { isPlatformUser: false, ...overrides };
}

function asUser<T>(context: TenantContext, fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run(context, fn);
}

describe('Tenant AI Assistant isolation & grounding (TEN-050/051/054/055, DP-100/102, FR-AIT-011/012)', () => {
  let pool: Pool;
  const classIds: string[] = [];
  const studentIds: string[] = [];
  const teacherAssignmentIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), async () => {
        await cleanup.query(`delete from assistant_interactions where request_category = 'attendance_below_threshold'`);
        await cleanup.query(`delete from assistant_settings where tenant_id = current_tenant_id()`);
        await cleanup.query(`delete from attendance_records where class_id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from teacher_assignments where id = any($1::uuid[])`, [teacherAssignmentIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; retrieval: AssistantRetrievalService; settings: AssistantSettingsService } {
    const conn = new WorkerTenantConnection(pool);
    const teacherAssignments = new TeacherAssignmentsService(conn);
    const settings = new AssistantSettingsService(conn);
    const logger = new AssistantInteractionLogger(conn);
    return { conn, retrieval: new AssistantRetrievalService(conn, teacherAssignments, settings, logger), settings };
  }

  /** A brand-new class (never the seeded one, which already carries the
   * one attendance row tenant-isolation.e2e-spec.ts's exact-count
   * assertion depends on) plus a brand-new student, so fixtures here never
   * collide with any other suite's assumptions. */
  async function createClassAndStudent(conn: WorkerTenantConnection, tenantId: string, schoolId: string, academicYearId: string) {
    const suffix = uniqueSuffix();
    const [classRow] = await asUser(ctx({ tenantId, userId: HEADMASTER, roles: ['headmaster'] }), () =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [academicYearId, `EC-Ch47 Class ${suffix}`, 'JHS 2', HEADMASTER],
      ),
    );
    classIds.push(classRow.id);

    const [studentRow] = await asUser(ctx({ tenantId, userId: HEADMASTER, roles: ['headmaster'] }), () =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, dob, gender)
         values (current_tenant_id(), $1, $2, 'Test', 'Student', '2015-01-01', 'F') returning id`,
        [schoolId, `EC-CH47-${suffix}`],
      ),
    );
    studentIds.push(studentRow.id);

    return { classId: classRow.id, studentId: studentRow.id };
  }

  /** Inserts one attendance_records row per status, on sequential dates,
   * for the given student+class — the shape findLowAttendance()'s query
   * groups over. */
  async function seedAttendance(conn: WorkerTenantConnection, tenantId: string, classId: string, studentId: string, statuses: Array<'present' | 'absent'>) {
    await asUser(ctx({ tenantId, userId: HEADMASTER, roles: ['headmaster'] }), async () => {
      for (let i = 0; i < statuses.length; i++) {
        await conn.query(
          `insert into attendance_records (tenant_id, student_id, class_id, attendance_date, status, created_by, updated_by)
           values (current_tenant_id(), $1, $2, $3, $4, $5, $5)`,
          [studentId, classId, `2026-09-${String(i + 1).padStart(2, '0')}`, statuses[i], HEADMASTER],
        );
      }
    });
  }

  async function assignTeacher(conn: WorkerTenantConnection, tenantId: string, teacherId: string, classId: string, academicYearId: string) {
    const [row] = await asUser(ctx({ tenantId, userId: HEADMASTER, roles: ['headmaster'] }), () =>
      conn.query<{ id: string }>(
        `insert into teacher_assignments (tenant_id, teacher_id, class_id, subject_id, academic_year_id, created_by, updated_by)
         values (current_tenant_id(), $1, $2, '55555555-0000-0000-0000-000000000001', $3, $4, $4) returning id`,
        [teacherId, classId, academicYearId, HEADMASTER],
      ),
    );
    teacherAssignmentIds.push(row.id);
    return row.id;
  }

  describe('tenant isolation and Chapter 13.3 scope (TEN-050/051)', () => {
    it("a cross-tenant caller gets zero low-attendance rows, never Tenant A's", async () => {
      const { conn, retrieval } = harness();
      try {
        const { classId, studentId } = await createClassAndStudent(conn, TENANT_A, SCHOOL_A, ACADEMIC_YEAR_A);
        await seedAttendance(conn, TENANT_A, classId, studentId, ['present', 'absent', 'absent', 'absent']);

        const result = await asUser(ctx({ tenantId: TENANT_B, userId: HEADMASTER, roles: ['proprietor'] }), () =>
          retrieval.findLowAttendance({ thresholdPercentage: 80, startDate: '2026-09-01', endDate: '2026-09-30' }),
        );

        expect(result.records).toHaveLength(0);
        expect(result.totalCount).toBe(0);
      } finally {
        conn.release();
      }
    });

    it('a pure-teacher caller with no active assignment for the queried class gets zero rows, not another class', async () => {
      const { conn, retrieval } = harness();
      try {
        const { classId, studentId } = await createClassAndStudent(conn, TENANT_A, SCHOOL_A, ACADEMIC_YEAR_A);
        await seedAttendance(conn, TENANT_A, classId, studentId, ['absent', 'absent', 'absent', 'present']);
        // Deliberately no teacher_assignments row for TEACHER against this class.

        const result = await asUser(ctx({ tenantId: TENANT_A, userId: TEACHER, roles: ['teacher'] }), () =>
          retrieval.findLowAttendance({ thresholdPercentage: 80, startDate: '2026-09-01', endDate: '2026-09-30' }),
        );

        expect(result.records.find((r) => r.classId === classId)).toBeUndefined();
      } finally {
        conn.release();
      }
    });

    it("a pure-teacher caller assigned to exactly one class only ever sees that class's low-attendance rows", async () => {
      const { conn, retrieval } = harness();
      try {
        const assigned = await createClassAndStudent(conn, TENANT_A, SCHOOL_A, ACADEMIC_YEAR_A);
        const unassigned = await createClassAndStudent(conn, TENANT_A, SCHOOL_A, ACADEMIC_YEAR_A);
        await seedAttendance(conn, TENANT_A, assigned.classId, assigned.studentId, ['absent', 'absent', 'absent', 'present']);
        await seedAttendance(conn, TENANT_A, unassigned.classId, unassigned.studentId, ['absent', 'absent', 'absent', 'present']);
        await assignTeacher(conn, TENANT_A, TEACHER, assigned.classId, ACADEMIC_YEAR_A);

        const result = await asUser(ctx({ tenantId: TENANT_A, userId: TEACHER, roles: ['teacher'] }), () =>
          retrieval.findLowAttendance({ thresholdPercentage: 80, startDate: '2026-09-01', endDate: '2026-09-30' }),
        );

        const classIdsSeen = new Set(result.records.map((r) => r.classId));
        expect(classIdsSeen.has(assigned.classId)).toBe(true);
        expect(classIdsSeen.has(unassigned.classId)).toBe(false);
      } finally {
        conn.release();
      }
    });

    it('a headmaster-tier caller is unrestricted, same as every other attendance read path', async () => {
      const { conn, retrieval } = harness();
      try {
        const a = await createClassAndStudent(conn, TENANT_A, SCHOOL_A, ACADEMIC_YEAR_A);
        const b = await createClassAndStudent(conn, TENANT_A, SCHOOL_A, ACADEMIC_YEAR_A);
        await seedAttendance(conn, TENANT_A, a.classId, a.studentId, ['absent', 'absent', 'absent', 'present']);
        await seedAttendance(conn, TENANT_A, b.classId, b.studentId, ['absent', 'absent', 'absent', 'present']);
        // No teacher_assignments row at all — headmaster's roles aren't exactly ['teacher'], so getCallerScope() is unrestricted regardless.

        const result = await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
          retrieval.findLowAttendance({ thresholdPercentage: 80, startDate: '2026-09-01', endDate: '2026-09-30' }),
        );

        const classIdsSeen = new Set(result.records.map((r) => r.classId));
        expect(classIdsSeen.has(a.classId)).toBe(true);
        expect(classIdsSeen.has(b.classId)).toBe(true);
      } finally {
        conn.release();
      }
    });

    it("an adversarial classId (Tenant B's own class, or one the caller has no assignment for) never bypasses scope filtering", async () => {
      const { conn, retrieval } = harness();
      try {
        const tenantBClass = await createClassAndStudent(conn, TENANT_B, 'bbbbbbbb-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002');
        const unassigned = await createClassAndStudent(conn, TENANT_A, SCHOOL_A, ACADEMIC_YEAR_A);
        await seedAttendance(conn, TENANT_B, tenantBClass.classId, tenantBClass.studentId, ['absent', 'absent', 'absent', 'present']);
        await seedAttendance(conn, TENANT_A, unassigned.classId, unassigned.studentId, ['absent', 'absent', 'absent', 'present']);

        // Spoofed classId belonging to Tenant B, while acting as a Tenant A teacher.
        const crossTenantAttempt = await asUser(ctx({ tenantId: TENANT_A, userId: TEACHER, roles: ['teacher'] }), () =>
          retrieval.findLowAttendance({
            thresholdPercentage: 80,
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            classId: tenantBClass.classId,
          }),
        );
        expect(crossTenantAttempt.records).toHaveLength(0);

        // classId the caller genuinely has no assignment for, same tenant.
        const unassignedAttempt = await asUser(ctx({ tenantId: TENANT_A, userId: TEACHER, roles: ['teacher'] }), () =>
          retrieval.findLowAttendance({
            thresholdPercentage: 80,
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            classId: unassigned.classId,
          }),
        );
        expect(unassignedAttempt.records).toHaveLength(0);
      } finally {
        conn.release();
      }
    });
  });

  describe('impersonation and tenant-admin disable (TEN-055, §47.13 disable NFR)', () => {
    it('a request under an active impersonation grant is refused with TEN-055, regardless of role', async () => {
      const { conn, retrieval } = harness();
      try {
        await expect(
          asUser(
            ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], impersonationGrantId: 'a1000000-0000-0000-0000-000000000001' }),
            () => retrieval.findLowAttendance({ thresholdPercentage: 80, startDate: '2026-09-01', endDate: '2026-09-30' }),
          ),
        ).rejects.toThrow(/TEN-055/);
      } finally {
        conn.release();
      }
    });

    it('a request against a tenant-disabled Assistant is refused immediately, no cached prior "enabled" state', async () => {
      const { conn, retrieval, settings } = harness();
      try {
        await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
          settings.update({ isEnabled: false }),
        );

        await expect(
          asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
            retrieval.findLowAttendance({ thresholdPercentage: 80, startDate: '2026-09-01', endDate: '2026-09-30' }),
          ),
        ).rejects.toThrow(/disabled for this tenant/);
      } finally {
        await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
          settings.update({ isEnabled: true }),
        );
        conn.release();
      }
    });

    it("a request from a role listed in disabled_role_codes is refused even though the tenant's Assistant is globally enabled", async () => {
      const { conn, retrieval, settings } = harness();
      try {
        await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
          settings.update({ isEnabled: true, disabledRoleCodes: ['teacher'] }),
        );

        await expect(
          asUser(ctx({ tenantId: TENANT_A, userId: TEACHER, roles: ['teacher'] }), () =>
            retrieval.findLowAttendance({ thresholdPercentage: 80, startDate: '2026-09-01', endDate: '2026-09-30' }),
          ),
        ).rejects.toThrow(/disabled for your role/);

        // Headmaster is unaffected — the tenant is still globally enabled.
        await expect(
          asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
            retrieval.findLowAttendance({ thresholdPercentage: 80, startDate: '2026-09-01', endDate: '2026-09-30' }),
          ),
        ).resolves.toBeDefined();
      } finally {
        await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
          settings.update({ isEnabled: true, disabledRoleCodes: [] }),
        );
        conn.release();
      }
    });
  });

  describe('DP-100 category allowlist', () => {
    it('rejects a health-records category outright — structural allowlist, not a per-query check', () => {
      expect(() => assertCategoryAllowed('health_records')).toThrow(/excluded from retrieval/);
    });

    it('rejects a discipline-records category outright, same as health', () => {
      expect(() => assertCategoryAllowed('discipline_records')).toThrow(/excluded from retrieval/);
    });

    it('accepts the one category actually built', () => {
      expect(() => assertCategoryAllowed('attendance_below_threshold')).not.toThrow();
    });
  });

  describe('response shape guarantees (DP-102, FR-AIT-011, FR-AIT-012)', () => {
    it('a served response never includes full student-profile fields (dob, gender, admission_no) — DP-102 minimal projection', async () => {
      const { conn, retrieval } = harness();
      try {
        const { classId, studentId } = await createClassAndStudent(conn, TENANT_A, SCHOOL_A, ACADEMIC_YEAR_A);
        await seedAttendance(conn, TENANT_A, classId, studentId, ['absent', 'absent', 'absent', 'present']);

        const result = await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
          retrieval.findLowAttendance({ thresholdPercentage: 80, startDate: '2026-09-01', endDate: '2026-09-30', classId }),
        );

        expect(result.records.length).toBeGreaterThan(0);
        for (const record of result.records) {
          expect(record).not.toHaveProperty('dob');
          expect(record).not.toHaveProperty('gender');
          expect(record).not.toHaveProperty('admissionNo');
        }
      } finally {
        conn.release();
      }
    });

    it('every record in a served response carries a navigable recordType+recordId reference (FR-AIT-011)', async () => {
      const { conn, retrieval } = harness();
      try {
        const { classId, studentId } = await createClassAndStudent(conn, TENANT_A, SCHOOL_A, ACADEMIC_YEAR_A);
        await seedAttendance(conn, TENANT_A, classId, studentId, ['absent', 'absent', 'absent', 'present']);

        const result = await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
          retrieval.findLowAttendance({ thresholdPercentage: 80, startDate: '2026-09-01', endDate: '2026-09-30', classId }),
        );

        expect(result.records.length).toBeGreaterThan(0);
        for (const record of result.records) {
          expect(record.refs).toEqual(
            expect.arrayContaining([
              { recordType: 'student', recordId: record.studentId },
              { recordType: 'class', recordId: record.classId },
            ]),
          );
        }
      } finally {
        conn.release();
      }
    });

    it('a response states totalCount and truncated=true once results exceed the 50-record cap (FR-AIT-012)', async () => {
      const { conn, retrieval } = harness();
      try {
        // Bulk-create 51 distinct students in one class, all below threshold —
        // cheaper than 51 individual Node-side inserts, and this test's own
        // fixtures are tracked for cleanup the same as everywhere else in
        // this file (via generate_series-produced ids, fetched back here).
        const { classId } = await createClassAndStudent(conn, TENANT_A, SCHOOL_A, ACADEMIC_YEAR_A);
        const bulkStudentIds = await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
          conn.query<{ id: string }>(
            `insert into students (tenant_id, school_id, admission_no, first_name, last_name)
             select current_tenant_id(), $1, 'EC-CH47-BULK-' || g, 'Bulk', 'Student ' || g
             from generate_series(1, 51) g
             returning id`,
            [SCHOOL_A],
          ),
        );
        studentIds.push(...bulkStudentIds.map((r) => r.id));

        await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), async () => {
          for (const { id: studentId } of bulkStudentIds) {
            await conn.query(
              `insert into attendance_records (tenant_id, student_id, class_id, attendance_date, status, created_by, updated_by)
               values (current_tenant_id(), $1, $2, '2026-09-01', 'absent', $3, $3),
                      (current_tenant_id(), $1, $2, '2026-09-02', 'present', $3, $3)`,
              [studentId, classId, HEADMASTER],
            );
          }
        });

        const result = await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
          retrieval.findLowAttendance({ thresholdPercentage: 80, startDate: '2026-09-01', endDate: '2026-09-30', classId }),
        );

        expect(result.totalCount).toBe(51);
        expect(result.records).toHaveLength(50);
        expect(result.truncated).toBe(true);
      } finally {
        conn.release();
      }
    });
  });

  describe('audit trail (FR-AIT-600)', () => {
    it('a served retrieval writes exactly one assistant_interactions row with status=served and null model/question/response fields', async () => {
      const { conn, retrieval } = harness();
      try {
        const { classId, studentId } = await createClassAndStudent(conn, TENANT_A, SCHOOL_A, ACADEMIC_YEAR_A);
        await seedAttendance(conn, TENANT_A, classId, studentId, ['absent', 'absent', 'absent', 'present']);

        await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
          retrieval.findLowAttendance({ thresholdPercentage: 80, startDate: '2026-09-01', endDate: '2026-09-30', classId }),
        );

        const rows = await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
          conn.query<{
            status: string;
            question_text: string | null;
            response_text: string | null;
            model_version: string | null;
            retrieved_record_ids: string[];
          }>(
            `select status, question_text, response_text, model_version, retrieved_record_ids
             from assistant_interactions
             where request_category = 'attendance_below_threshold' and actor_user_id = $1
             order by created_at desc limit 1`,
            [HEADMASTER],
          ),
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('served');
        expect(rows[0].question_text).toBeNull();
        expect(rows[0].response_text).toBeNull();
        expect(rows[0].model_version).toBeNull();
        expect(rows[0].retrieved_record_ids).toEqual(expect.arrayContaining([studentId, classId]));
      } finally {
        conn.release();
      }
    });

    it('a denied retrieval (impersonation) still writes a row with status=denied and a denial_reason', async () => {
      const { conn, retrieval } = harness();
      try {
        await expect(
          asUser(
            ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], impersonationGrantId: 'a1000000-0000-0000-0000-000000000002' }),
            () => retrieval.findLowAttendance({ thresholdPercentage: 80, startDate: '2026-09-01', endDate: '2026-09-30' }),
          ),
        ).rejects.toThrow();

        const rows = await asUser(ctx({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'] }), () =>
          conn.query<{ status: string; denial_reason: string | null }>(
            `select status, denial_reason from assistant_interactions
             where request_category = 'attendance_below_threshold' and actor_user_id = $1
             order by created_at desc limit 1`,
            [HEADMASTER],
          ),
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('denied');
        expect(rows[0].denial_reason).toMatch(/TEN-055/);
      } finally {
        conn.release();
      }
    });
  });
});
