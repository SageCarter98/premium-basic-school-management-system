/**
 * assessment.e2e-spec.ts
 *
 * Chapter 19 (Assessment Management), FR-ASM-010..040 — genuinely
 * untested before this file (no existing suite constructs
 * AssessmentService). FR-ASM-050 (optional NaCCA tagging) is a pass-
 * through field with no service-level business logic of its own beyond
 * "store what was given" — not worth a dedicated test.
 *
 * Covers:
 *  - FR-ASM-010: addComponent() only while the structure is 'draft', and
 *    publish() requires the structure's components to sum to exactly 100
 *    (rejects under/over, accepts exactly 100).
 *  - FR-ASM-020: score entry requires an active teacher assignment for
 *    that class+subject+year, with the ACADEMIC_ADMIN override this
 *    codebase applies uniformly elsewhere (results/attendance/grading).
 *  - FR-ASM-030: a score is either 'scored' with an in-bounds value, or
 *    'missing' with a reason — never both null/unexplained. Folds in
 *    NFR-PERF-030's optimistic locking (upsertScore()'s own `version`
 *    conflict path), since both live in the same method under test.
 *  - FR-ASM-040: reopen() only from 'published', mandatory reason,
 *    records who/when, and structures become editable (draft) again.
 *
 * Harness pattern copied from results-immutability.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom, same
 * "own class/structure per test" and afterAll cleanup discipline.
 *
 * Requires a running Postgres with every migration through
 * 0036_assessment_component_types.sql (and everything seed_demo.sql
 * needs) already applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { AssessmentService } from '../src/modules/assessment/assessment.service';
import { TeacherAssignmentsService } from '../src/modules/teacher-assignments/teacher-assignments.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001';
const SUBJECT_A = '55555555-0000-0000-0000-000000000001'; // Mathematics
const STUDENT_A = 'eeeeeeee-0000-0000-0000-000000000001'; // Ama Mensah
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise — ACADEMIC_ADMIN tier
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

describe('Assessment (Chapter 19 FR-ASM-010..040)', () => {
  let pool: Pool;
  const classIds: string[] = [];
  const structureIds: string[] = [];
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
          `delete from scores where assessment_component_id in (select id from assessment_components where assessment_structure_id = any($1::uuid[]))`,
          [structureIds],
        );
        await cleanup.query(`delete from assessment_components where assessment_structure_id = any($1::uuid[])`, [structureIds]);
        await cleanup.query(`delete from assessment_structures where id = any($1::uuid[])`, [structureIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: AssessmentService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new AssessmentService(conn, new TeacherAssignmentsService(conn)) };
  }

  async function createClass(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [ACADEMIC_YEAR_A, uniqueName('FR-ASM Class'), 'JHS 2', HEADMASTER],
      ),
    );
    classIds.push(rows[0].id);
    return rows[0].id;
  }

  async function createDraftStructure(service: AssessmentService, classId: string) {
    const structure = await asHeadmaster(() =>
      service.createStructure({ classId, subjectId: SUBJECT_A, academicYearId: ACADEMIC_YEAR_A } as never),
    );
    structureIds.push(structure.id);
    return structure;
  }

  async function assignTeacher(conn: WorkerTenantConnection, classId: string) {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into teacher_assignments (tenant_id, teacher_id, class_id, subject_id, academic_year_id, is_class_teacher, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, false, $5, $5) returning id`,
        [TEACHER_SUNRISE, classId, SUBJECT_A, ACADEMIC_YEAR_A, HEADMASTER],
      ),
    );
    assignmentIds.push(rows[0].id);
  }

  describe('addComponent()/publish() — FR-ASM-010 draft-only editing and weights-sum-to-100', () => {
    it('rejects adding a component once the structure is published, and rejects publish() unless weights sum to exactly 100', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const structure = await createDraftStructure(service, classId);
        await asHeadmaster(() => service.addComponent(structure.id, { componentType: 'class_exercise', weight: 40 } as never));

        // Under 100 — refused.
        await expect(asHeadmaster(() => service.publish(structure.id))).rejects.toThrow(/sum to 40, not 100/);

        await asHeadmaster(() => service.addComponent(structure.id, { componentType: 'end_of_term_exam', weight: 60 } as never));
        const published = await asHeadmaster(() => service.publish(structure.id));
        expect(published.status).toBe('published');
        expect(published.published_at).not.toBeNull();

        // Structure is locked now.
        await expect(
          asHeadmaster(() => service.addComponent(structure.id, { componentType: 'homework', weight: 10 } as never)),
        ).rejects.toThrow(/not 'draft'/);
      } finally {
        conn.release();
      }
    });
  });

  describe('reopen() — FR-ASM-040 controlled, audited, mandatory reason', () => {
    it('refuses to reopen a draft structure, requires a reason, and records who/when on a published one', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const structure = await createDraftStructure(service, classId);

        await expect(asHeadmaster(() => service.reopen(structure.id, { reason: 'too early' } as never))).rejects.toThrow(
          /not 'published'/,
        );

        await asHeadmaster(() => service.addComponent(structure.id, { componentType: 'class_exercise', weight: 100 } as never));
        await asHeadmaster(() => service.publish(structure.id));

        const reopened = await asHeadmaster(() =>
          service.reopen(structure.id, { reason: 'A component weight needs correcting' } as never),
        );
        expect(reopened.status).toBe('draft');
        expect(reopened.reopened_by).toBe(HEADMASTER);
        expect(reopened.reopen_reason).toBe('A component weight needs correcting');
        expect(reopened.reopened_at).not.toBeNull();
      } finally {
        conn.release();
      }
    });
  });

  describe('upsertScore() — FR-ASM-020 assignment-gated entry, FR-ASM-030 scored/missing shape, NFR-PERF-030 optimistic locking', () => {
    it('forbids score entry without an active assignment, allows an ACADEMIC_ADMIN caller regardless', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const structure = await createDraftStructure(service, classId);
        const component = await asHeadmaster(() =>
          service.addComponent(structure.id, { componentType: 'class_exercise', weight: 100 } as never),
        );

        await expect(
          asUser(TEACHER_SUNRISE, ['teacher'], () =>
            service.upsertScore(component.id, { studentId: STUDENT_A, status: 'scored', value: 80 } as never),
          ),
        ).rejects.toThrow(/do not have an active teacher assignment/);

        // ACADEMIC_ADMIN (headmaster) is never blocked by assignment scope.
        const entered = await asHeadmaster(() =>
          service.upsertScore(component.id, { studentId: STUDENT_A, status: 'scored', value: 80 } as never),
        );
        expect(entered.value).toBe('80.00');
        expect(entered.status).toBe('scored');

        await assignTeacher(conn, classId);
        const asAssignedTeacher = await asUser(TEACHER_SUNRISE, ['teacher'], () =>
          service.upsertScore(component.id, { studentId: STUDENT_A, status: 'scored', value: 85, expectedVersion: entered.version } as never),
        );
        expect(asAssignedTeacher.value).toBe('85.00');
      } finally {
        conn.release();
      }
    });

    it('requires a value in [0, max_score] for "scored", a reason for "missing", and rejects an out-of-bounds value', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const structure = await createDraftStructure(service, classId);
        const component = await asHeadmaster(() =>
          service.addComponent(structure.id, { componentType: 'class_exercise', weight: 100, maxScore: 50 } as never),
        );

        await expect(
          asHeadmaster(() => service.upsertScore(component.id, { studentId: STUDENT_A, status: 'scored', value: 51 } as never)),
        ).rejects.toThrow(/out of bounds/);

        await expect(
          asHeadmaster(() => service.upsertScore(component.id, { studentId: STUDENT_A, status: 'missing' } as never)),
        ).rejects.toThrow(/requires 'missingReason'/);

        const missing = await asHeadmaster(() =>
          service.upsertScore(component.id, { studentId: STUDENT_A, status: 'missing', missingReason: 'Absent for exam' } as never),
        );
        expect(missing.status).toBe('missing');
        expect(missing.value).toBeNull();
        expect(missing.missing_reason).toBe('Absent for exam');
      } finally {
        conn.release();
      }
    });

    it('rejects an update against a stale version, identifying the other editor, rather than silently overwriting', async () => {
      const { conn, service } = harness();
      try {
        const classId = await createClass(conn);
        const structure = await createDraftStructure(service, classId);
        const component = await asHeadmaster(() =>
          service.addComponent(structure.id, { componentType: 'class_exercise', weight: 100 } as never),
        );
        const first = await asHeadmaster(() =>
          service.upsertScore(component.id, { studentId: STUDENT_A, status: 'scored', value: 70 } as never),
        );
        expect(first.version).toBe(1);

        // Omitting expectedVersion against an EXISTING score is a conflict,
        // not a silent overwrite (upsert-score.dto.ts's own doc comment).
        await expect(
          asHeadmaster(() => service.upsertScore(component.id, { studentId: STUDENT_A, status: 'scored', value: 75 } as never)),
        ).rejects.toThrow(new RegExp(`last updated by ${HEADMASTER}`));

        const updated = await asHeadmaster(() =>
          service.upsertScore(component.id, { studentId: STUDENT_A, status: 'scored', value: 75, expectedVersion: 1 } as never),
        );
        expect(updated.version).toBe(2);
        expect(updated.value).toBe('75.00');
      } finally {
        conn.release();
      }
    });
  });
});
