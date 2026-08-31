/**
 * grading.e2e-spec.ts
 *
 * Chapter 20 (Enterprise Grading Engine), FR-GRA-010..070 — genuinely
 * untested before this file (no existing suite constructs GradingService
 * at all). Covers the pieces of the pipeline the requirement text names
 * explicitly:
 *
 *  - FR-GRA-030's "no unintended gaps" half of scale validation
 *    (the overlap half is DB-enforced and already covered by
 *    results-immutability.e2e-spec.ts's EXCLUDE-constraint test).
 *  - FR-GRA-040's weighted pipeline (scores -> percentage -> scale lookup
 *    -> grade), and FR-GRA-070 (the computed result's grading_policy_id
 *    is exactly the one passed to compute(), folded into the same test
 *    rather than a separate one — it's a single assertion on the same
 *    fixture, not a distinct scenario).
 *  - FR-GRA-060's "stop processing" contract: one student's incomplete
 *    component doesn't just skip that student, it aborts the whole
 *    transaction (see grading.service.ts's own header comment on why
 *    compute() runs as one BEGIN/COMMIT across the roster).
 *  - FR-GRA-050's competition/dense tie modes and the developmental
 *    override that forces 'none' regardless of the requested mode.
 *
 * Fixtures are built with direct SQL for assessment_structures/
 * assessment_components/scores/enrolments (published/scored/active
 * respectively) rather than routing through assessment.service.ts's own
 * publish() pipeline — this file is testing the grading engine's
 * consumption of already-approved data, not assessment's own publish
 * workflow, which is a different module's concern. grading_policies and
 * grading_scale_items ARE created through GradingService itself
 * (createPolicy/addScaleItem/activatePolicy), since FR-GRA-030's
 * validation logic under test lives in activatePolicy().
 *
 * Harness pattern copied from results-immutability.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom, same
 * "own class/students per test" and afterAll cleanup discipline.
 *
 * Requires a running Postgres with every migration through
 * 0005_grading.sql (and everything seed_demo.sql needs) already applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { GradingService } from '../src/modules/grading/grading.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001';
const SUBJECT_A = '55555555-0000-0000-0000-000000000001'; // Mathematics
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

function asUser<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Grading engine (Chapter 20 FR-GRA-010..070)', () => {
  let pool: Pool;
  const classIds: string[] = [];
  const studentIds: string[] = [];
  const structureIds: string[] = [];
  const policyIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asUser(async () => {
        await cleanup.query(`delete from result_candidates where assessment_structure_id = any($1::uuid[])`, [structureIds]);
        await cleanup.query(
          `delete from scores where assessment_component_id in (select id from assessment_components where assessment_structure_id = any($1::uuid[]))`,
          [structureIds],
        );
        await cleanup.query(`delete from assessment_components where assessment_structure_id = any($1::uuid[])`, [structureIds]);
        await cleanup.query(`delete from assessment_structures where id = any($1::uuid[])`, [structureIds]);
        await cleanup.query(`delete from grading_scale_items where grading_policy_id = any($1::uuid[])`, [policyIds]);
        await cleanup.query(`delete from grading_policies where id = any($1::uuid[])`, [policyIds]);
        await cleanup.query(`delete from enrolments where class_id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: GradingService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new GradingService(conn) };
  }

  async function createClass(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asUser(() =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [ACADEMIC_YEAR_A, uniqueName('FR-GRA Class'), 'JHS 2', HEADMASTER],
      ),
    );
    const classId = rows[0].id;
    classIds.push(classId);
    return classId;
  }

  async function createEnrolledStudent(conn: WorkerTenantConnection, classId: string): Promise<string> {
    const studentRows = await asUser(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-GRA', 'Fixture', $3, $3) returning id`,
        [SCHOOL_A, uniqueName('ADM'), HEADMASTER],
      ),
    );
    const studentId = studentRows[0].id;
    studentIds.push(studentId);
    await asUser(() =>
      conn.query(
        `insert into enrolments (tenant_id, student_id, academic_year_id, class_id, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4)`,
        [studentId, ACADEMIC_YEAR_A, classId, HEADMASTER],
      ),
    );
    return studentId;
  }

  /** A published structure with two weighted components (60/40, max 100
   * each) — enough to exercise FR-GRA-040's weighted-sum pipeline without
   * routing through assessment.service.ts's own publish() workflow. */
  async function createPublishedStructure(conn: WorkerTenantConnection, classId: string) {
    const structureRows = await asUser(() =>
      conn.query<{ id: string }>(
        `insert into assessment_structures (tenant_id, class_id, subject_id, academic_year_id, status, published_at, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, 'published', now(), $4, $4) returning id`,
        [classId, SUBJECT_A, ACADEMIC_YEAR_A, HEADMASTER],
      ),
    );
    const structureId = structureRows[0].id;
    structureIds.push(structureId);

    const componentRows = await asUser(() =>
      conn.query<{ id: string }>(
        `insert into assessment_components (tenant_id, assessment_structure_id, component_type, weight, max_score, created_by, updated_by)
         values
           (current_tenant_id(), $1, 'class_exercise', 60, 100, $2, $2),
           (current_tenant_id(), $1, 'end_of_term_exam', 40, 100, $2, $2)
         returning id`,
        [structureId, HEADMASTER],
      ),
    );
    return { structureId, componentIds: componentRows.map((r) => r.id) };
  }

  async function score(conn: WorkerTenantConnection, componentId: string, studentId: string, value: number) {
    await asUser(() =>
      conn.query(
        `insert into scores (tenant_id, assessment_component_id, student_id, value, status, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, 'scored', $4, $4)`,
        [componentId, studentId, value, HEADMASTER],
      ),
    );
  }

  /** A 2-band numerical policy (0-49 fail 'F', 50-100 pass 'P'),
   * activated via the real service so FR-GRA-030's coverage validation
   * genuinely runs. */
  async function createActiveNumericalPolicy(service: GradingService) {
    const policy = await asUser(() =>
      service.createPolicy({ name: uniqueName('FR-GRA Policy'), applicability: 'numerical' } as never),
    );
    policyIds.push(policy.id);
    await asUser(() => service.addScaleItem(policy.id, { minValue: 0, maxValue: 49.99, grade: 'F', isPass: false } as never));
    await asUser(() => service.addScaleItem(policy.id, { minValue: 50, maxValue: 100, grade: 'P', isPass: true } as never));
    return asUser(() => service.activatePolicy(policy.id));
  }

  describe('activatePolicy() — FR-GRA-030 coverage validation (gap half; overlap is DB-enforced elsewhere)', () => {
    it('rejects a policy whose scale items leave a gap between 0 and 100', async () => {
      const { conn, service } = harness();
      try {
        const policy = await asUser(() =>
          service.createPolicy({ name: uniqueName('Gappy Policy'), applicability: 'numerical' } as never),
        );
        policyIds.push(policy.id);
        await asUser(() => service.addScaleItem(policy.id, { minValue: 0, maxValue: 50, grade: 'F', isPass: false } as never));
        // Gap: 50.01-59.99 belongs to no band.
        await asUser(() => service.addScaleItem(policy.id, { minValue: 60, maxValue: 100, grade: 'P', isPass: true } as never));

        await expect(asUser(() => service.activatePolicy(policy.id))).rejects.toThrow(/gap between/);
      } finally {
        conn.release();
      }
    });
  });

  describe('compute() — FR-GRA-040 weighted pipeline and FR-GRA-070 policy-version retention', () => {
    it('computes percentage/grade/is_pass from weighted component scores, storing the exact policy used', async () => {
      const { conn, service } = harness();
      try {
        const policy = await createActiveNumericalPolicy(service);
        const classId = await createClass(conn);
        const studentPass = await createEnrolledStudent(conn, classId);
        const studentFail = await createEnrolledStudent(conn, classId);
        const { structureId, componentIds } = await createPublishedStructure(conn, classId);

        // Pass: 60%*90 + 40%*80 = 86.00
        await score(conn, componentIds[0], studentPass, 90);
        await score(conn, componentIds[1], studentPass, 80);
        // Fail: 60%*30 + 40%*20 = 26.00
        await score(conn, componentIds[0], studentFail, 30);
        await score(conn, componentIds[1], studentFail, 20);

        const results = await asUser(() => service.compute(structureId, { gradingPolicyId: policy.id } as never));
        const passResult = results.find((r) => r.student_id === studentPass)!;
        const failResult = results.find((r) => r.student_id === studentFail)!;

        expect(passResult.percentage).toBe('86.00');
        expect(passResult.grade).toBe('P');
        expect(passResult.is_pass).toBe(true);
        expect(passResult.grading_policy_id).toBe(policy.id); // FR-GRA-070

        expect(failResult.percentage).toBe('26.00');
        expect(failResult.grade).toBe('F');
        expect(failResult.is_pass).toBe(false);
      } finally {
        conn.release();
      }
    });

    it('FR-GRA-060: aborts the entire call, for every student, when even one student has an incomplete component', async () => {
      const { conn, service } = harness();
      try {
        const policy = await createActiveNumericalPolicy(service);
        const classId = await createClass(conn);
        const complete = await createEnrolledStudent(conn, classId);
        const incomplete = await createEnrolledStudent(conn, classId);
        const { structureId, componentIds } = await createPublishedStructure(conn, classId);

        await score(conn, componentIds[0], complete, 90);
        await score(conn, componentIds[1], complete, 80);
        await score(conn, componentIds[0], incomplete, 70);
        // incomplete's second component is never scored.

        await expect(asUser(() => service.compute(structureId, { gradingPolicyId: policy.id } as never))).rejects.toThrow(
          /has no scored entry/,
        );

        // The transaction-wide abort: `complete` (who WAS fully scored)
        // must not have a result_candidates row either.
        const results = await asUser(() => service.findResults(structureId));
        expect(results).toHaveLength(0);
      } finally {
        conn.release();
      }
    });
  });

  describe('rank() — FR-GRA-050 tie-handling modes and the developmental override', () => {
    async function computedFourWay(conn: WorkerTenantConnection, service: GradingService, applicability: string) {
      const policy = await asUser(() =>
        service.createPolicy({ name: uniqueName('Rank Policy'), applicability } as never),
      );
      policyIds.push(policy.id);
      await asUser(() => service.addScaleItem(policy.id, { minValue: 0, maxValue: 100, grade: 'X' } as never));
      const activated = await asUser(() => service.activatePolicy(policy.id));

      const classId = await createClass(conn);
      const { structureId, componentIds } = await createPublishedStructure(conn, classId);
      const percentages = [90, 80, 80, 70]; // a genuine tie at rank 2
      for (const pct of percentages) {
        const studentId = await createEnrolledStudent(conn, classId);
        await score(conn, componentIds[0], studentId, pct);
        await score(conn, componentIds[1], studentId, pct);
      }
      await asUser(() => service.compute(structureId, { gradingPolicyId: activated.id } as never));
      return structureId;
    }

    it('competition mode skips ranks after a tie (1, 2, 2, 4)', async () => {
      const { conn, service } = harness();
      try {
        const structureId = await computedFourWay(conn, service, 'numerical');
        const ranked = await asUser(() => service.rank(structureId, { mode: 'competition' } as never));
        expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
      } finally {
        conn.release();
      }
    });

    it('dense mode does not skip ranks after a tie (1, 2, 2, 3)', async () => {
      const { conn, service } = harness();
      try {
        const structureId = await computedFourWay(conn, service, 'numerical');
        const ranked = await asUser(() => service.rank(structureId, { mode: 'dense' } as never));
        expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 3]);
      } finally {
        conn.release();
      }
    });

    it('forces rank to null for a developmental-applicability policy, regardless of the requested mode', async () => {
      const { conn, service } = harness();
      try {
        const structureId = await computedFourWay(conn, service, 'developmental');
        const ranked = await asUser(() => service.rank(structureId, { mode: 'competition' } as never));
        expect(ranked.every((r) => r.rank === null)).toBe(true);
      } finally {
        conn.release();
      }
    });
  });
});
