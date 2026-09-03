/**
 * results-immutability.e2e-spec.ts
 *
 * The "results-immutability suite" CLAUDE.md's EC-400 has named as a
 * protected test suite since 2026-08-24 without it actually existing —
 * this file closes that documentation-drift gap for real, ahead of
 * EC-501.
 *
 * IMPORTANT, stated plainly rather than assumed: "immutability" here is
 * NOT uniformly database-enforced. pbsms_app has full, unrestricted
 * select/insert/update/delete on student_results, student_result_items,
 * and grading_scale_items — no trigger, no status-transition CHECK,
 * nothing structurally stopping a raw SQL UPDATE against a published/
 * superseded row. Only two things are genuinely DB-backed:
 *   1. idx_student_results_one_current — at most one non-superseded row
 *      per (tenant, student, class, academic_year).
 *   2. grading_scale_items' EXCLUDE USING gist — no overlapping ranges
 *      within the same grading_policy_id.
 * Everything else (submit/review/approve/publish/lock/archive's
 * transition guards, reopen()'s supersede-then-insert order) is a
 * property of what results.service.ts currently chooses to query, not a
 * structural guarantee the way tenant isolation is. This suite tests both
 * kinds honestly, including one test that proves the raw-SQL bypass
 * succeeds today, so a future reader never assumes stronger protection
 * exists than actually does.
 *
 * Harness: same WorkerTenantConnection + TenantContextStore.run() idiom
 * as finance-invariants.e2e-spec.ts (see that file's header for why —
 * ResultsService takes a Scope.REQUEST TenantDatabaseService, and also
 * needs a TeacherAssignmentsService, itself just TenantDatabaseService).
 * A `roles: ['headmaster']` actor is used throughout — getCallerScope()
 * treats any roles array that isn't "every role === 'teacher'" as
 * unrestricted, and 'headmaster' is in ACADEMIC_ADMIN, so this actor
 * skips both the class-level teacher-assignment scope check and the
 * Chapter 13.3 read-scope filter entirely — the transition/immutability
 * invariants below don't depend on that scope layer, which already has
 * its own coverage elsewhere.
 *
 * Fixtures: a brand-new `classes` row per test (never the seeded
 * ASSESSMENT_STRUCTURE_IN_TENANT_A/STUDENT_RESULT_IN_TENANT_A class) so
 * create()'s partial-unique-index check never collides with
 * tenant-isolation.e2e-spec.ts's own seeded fixture, which that other
 * suite depends on staying untouched. The new class has no assessment
 * structures at all, so publish()'s "every published structure has a
 * matching snapshotted item" check is trivially satisfied (nothing is
 * required) — this suite inserts one student_result_items row directly
 * via SQL instead of running a full grading pipeline, purely to satisfy
 * submit()'s "at least one item" precondition.
 *
 * Cleanup: every class/student_result this file creates (including a
 * reopen()'d row's new version) is tracked and deleted in `afterAll` —
 * finance-invariants.e2e-spec.ts's header explains why this isn't
 * optional: a first version of this file with no cleanup broke
 * tenant-isolation.e2e-spec.ts's exact-row-count assertions for
 * student_results/student_result_items within the same test run.
 *
 * Requires a running Postgres with every migration through
 * 0006_results.sql (and everything seed_demo.sql needs) already applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { ResultsService } from '../src/modules/results/results.service';
import { TeacherAssignmentsService } from '../src/modules/teacher-assignments/teacher-assignments.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001';
const STUDENT_A = 'eeeeeeee-0000-0000-0000-000000000001'; // Ama Mensah
const SUBJECT_A = '55555555-0000-0000-0000-000000000001'; // Mathematics
const GRADING_POLICY_A = 'a0000000-0000-0000-0000-000000000001';
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

function asUser<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function withoutSupersededAt<T extends { superseded_at: unknown }>(row: T): Omit<T, 'superseded_at'> {
  const { superseded_at, ...rest } = row;
  void superseded_at;
  return rest;
}

describe('Results immutability (EC-501 protected suite, Chapter 21 FR-RES-010/020/030)', () => {
  // FR-RES-010 (the 9-state machine: Draft, Submitted, Returned, Corrected,
  // Reviewed, Approved, Published, Locked, Archived) is fully exercised by
  // the 'status transition state machine' describe() below — the full
  // legal path plus returnForCorrection() together cover all nine states
  // and reject the out-of-order transitions tried against them. Added as an
  // explicit citation 2026-09-03 (EC-107): the ID existed nowhere in this
  // file even though the coverage did.
  let pool: Pool;
  const classIds: string[] = [];
  const resultIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asUser(async () => {
        await cleanup.query(`delete from student_result_items where student_result_id = any($1::uuid[])`, [resultIds]);
        await cleanup.query(`delete from student_results where id = any($1::uuid[])`, [resultIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
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

  /** Every reopen() call produces a genuinely new student_results row —
   * this wraps the service call so that new id is tracked for cleanup too,
   * not just the original result createOwnResult() returns. */
  async function reopen(service: ResultsService, id: string, reason: string) {
    const result = await asUser(() => service.reopen(id, { reason } as never));
    resultIds.push(result.id);
    return result;
  }

  /** A brand-new class (never the seeded one other suites depend on) plus
   * one draft student_results row with exactly one snapshotted item —
   * enough for submit() to accept it, without needing a real grading
   * pipeline (published assessment_structures/result_candidates). */
  async function createOwnResult(conn: WorkerTenantConnection, service: ResultsService) {
    const classRows = await asUser(() =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [ACADEMIC_YEAR_A, uniqueName('EC-501 Class'), 'JHS 2', HEADMASTER],
      ),
    );
    const classId = classRows[0].id;
    classIds.push(classId);

    const result = await asUser(() =>
      service.create({ studentId: STUDENT_A, classId, academicYearId: ACADEMIC_YEAR_A } as never),
    );
    resultIds.push(result.id);

    await asUser(() =>
      conn.query(
        `insert into student_result_items
           (tenant_id, student_result_id, subject_id, subject_name, grading_policy_id, percentage, grade, is_pass)
         values (current_tenant_id(), $1, $2, 'Mathematics', $3, 75.00, 'B', true)`,
        [result.id, SUBJECT_A, GRADING_POLICY_A],
      ),
    );

    return { classId, result };
  }

  describe('status transition state machine', () => {
    it('walks the full legal path (draft -> submitted -> reviewed -> approved -> published -> locked -> archived) and rejects out-of-order transitions', async () => {
      const { conn, service } = harness();
      try {
        const { result } = await createOwnResult(conn, service);

        const submitted = await asUser(() => service.submit(result.id));
        expect(submitted.status).toBe('submitted');

        // Out of order: can't publish straight from 'submitted'.
        await expect(asUser(() => service.publish(result.id))).rejects.toThrow(/not approved/);
        // Can't submit an already-submitted result.
        await expect(asUser(() => service.submit(result.id))).rejects.toThrow(/not draft\/corrected/);

        const reviewed = await asUser(() => service.review(result.id));
        expect(reviewed.status).toBe('reviewed');

        const approved = await asUser(() => service.approve(result.id));
        expect(approved.status).toBe('approved');

        const published = await asUser(() => service.publish(result.id));
        expect(published.status).toBe('published');
        expect(published.published_by).toBe(HEADMASTER);

        const locked = await asUser(() => service.lock(result.id));
        expect(locked.status).toBe('locked');

        const archived = await asUser(() => service.archive(result.id));
        expect(archived.status).toBe('archived');

        // Terminal in the sense that none of the ordinary transition
        // methods accept 'archived' as a source status.
        await expect(asUser(() => service.lock(result.id))).rejects.toThrow(/not published/);
      } finally {
        conn.release();
      }
    });

    it('returnForCorrection() gives approved (not just submitted/reviewed) a real way back to draft', async () => {
      const { conn, service } = harness();
      try {
        const { result } = await createOwnResult(conn, service);
        await asUser(() => service.submit(result.id));
        await asUser(() => service.approve(result.id));

        const returned = await asUser(() => service.returnForCorrection(result.id, { reason: 'missed subject' } as never));
        expect(returned.status).toBe('returned');

        const corrected = await asUser(() => service.correct(result.id));
        expect(corrected.status).toBe('corrected');

        // corrected can go straight back through submit(), same as draft.
        const resubmitted = await asUser(() => service.submit(result.id));
        expect(resubmitted.status).toBe('submitted');
      } finally {
        conn.release();
      }
    });
  });

  describe("reopen() supersedes rather than mutates (FR-RES-030)", () => {
    it('sets superseded_at on the old row (leaving its other fields unchanged) and inserts a genuinely new row', async () => {
      const { conn, service } = harness();
      try {
        const { result } = await createOwnResult(conn, service);
        await asUser(() => service.submit(result.id));
        await asUser(() => service.approve(result.id));
        const locked = await asUser(async () => {
          await service.publish(result.id);
          return service.lock(result.id);
        });

        const beforeReopen = await asUser(() => service.findOne(locked.id));
        expect(beforeReopen.superseded_at).toBeNull();

        const reopened = await reopen(service, locked.id, 'grade dispute upheld');

        expect(reopened.id).not.toBe(locked.id); // a genuinely new row, not the same one mutated
        expect(reopened.version).toBe(locked.version + 1);
        expect(reopened.previous_version_id).toBe(locked.id);
        expect(reopened.status).toBe('draft');

        const oldRowAfter = await asUser(() => service.findOne(locked.id));
        expect(oldRowAfter.superseded_at).not.toBeNull();
        // Every substantive field from immediately before the reopen is
        // untouched — only superseded_at changed.
        expect(withoutSupersededAt(oldRowAfter)).toEqual(withoutSupersededAt(beforeReopen));
      } finally {
        conn.release();
      }
    });

    it('DB backstop: a raw insert of a second non-superseded row for the same student+class+year hits the partial unique index', async () => {
      const { conn, service } = harness();
      try {
        const { classId } = await createOwnResult(conn, service);

        await expect(
          asUser(() =>
            conn.query(
              `insert into student_results (tenant_id, student_id, class_id, academic_year_id, version, created_by, updated_by)
               values (current_tenant_id(), $1, $2, $3, 1, $4, $4)`,
              [STUDENT_A, classId, ACADEMIC_YEAR_A, HEADMASTER],
            ),
          ),
        ).rejects.toThrow(/duplicate key value violates unique constraint/);
      } finally {
        conn.release();
      }
    });

    /**
     * REAL GAP FOUND WHILE SCOPING THIS SUITE, documented rather than
     * fixed (results is a protected zone; this is a test suite, not a fix
     * PR): reopen()'s guard only checks `old.status in ('published',
     * 'locked')` — it never checks old.superseded_at. Once a row has
     * already been reopened once, its status column is untouched by that
     * first reopen (only superseded_at changes), so calling reopen()
     * AGAIN on that same now-stale row still passes the status check and
     * attempts a second INSERT for the same (student, class, year) —
     * which the partial unique index does correctly reject, but as a raw,
     * unhandled constraint-violation error propagating out of reopen()'s
     * catch block (it only ROLLBACKs and re-throws), not a clean
     * ConflictException the way every other precondition failure in this
     * file is. No data corruption results — the index still holds — but
     * the failure mode is worse than the rest of this file's UX.
     */
    it('DOCUMENTED GAP: reopening an already-superseded row is only stopped by the unique-index collision, not a clean precondition check', async () => {
      const { conn, service } = harness();
      try {
        const { result } = await createOwnResult(conn, service);
        await asUser(() => service.submit(result.id));
        await asUser(() => service.approve(result.id));
        await asUser(() => service.publish(result.id));
        const locked = await asUser(() => service.lock(result.id));

        await reopen(service, locked.id, 'first reopen');

        // locked.status is still 'locked' in the DB (reopen() never
        // changed it) — so a second reopen() call against the SAME,
        // now-superseded row id still passes the status precondition...
        await expect(asUser(() => service.reopen(locked.id, { reason: 'second reopen on a stale row' } as never))).rejects.toThrow(
          /duplicate key value violates unique constraint/,
        );
      } finally {
        conn.release();
      }
    });
  });

  describe('grading scale bands can never overlap (DB-enforced, EXCLUDE USING gist)', () => {
    it('rejects a raw insert of an overlapping range within the same grading policy', async () => {
      const conn = new WorkerTenantConnection(pool);
      try {
        await expect(
          asUser(() =>
            conn.query(
              `insert into grading_scale_items (tenant_id, grading_policy_id, grade, min_value, max_value, created_by)
               values (current_tenant_id(), $1, 'ZZ', 40, 60, $2)`,
              [GRADING_POLICY_A, HEADMASTER],
            ),
          ),
        ).rejects.toThrow(/conflicting key value violates exclusion constraint/);
      } finally {
        conn.release();
      }
    });
  });

  describe('the real ceiling: content mutation on a published/superseded row is not DB-enforced', () => {
    it('PROVES (does not merely assume) that a raw UPDATE against a published, non-superseded row succeeds today', async () => {
      const { conn, service } = harness();
      try {
        const { result } = await createOwnResult(conn, service);
        await asUser(() => service.submit(result.id));
        await asUser(() => service.approve(result.id));
        const published = await asUser(() => service.publish(result.id));

        // No trigger, no status-transition CHECK, no column-level REVOKE —
        // pbsms_app has a plain, unrestricted UPDATE grant on
        // student_results (0006_results.sql). This succeeds; there is
        // nothing here to "expect to fail" — that IS the finding.
        await asUser(() =>
          conn.query(
            `update student_results set average_percentage = 100, overall_pass = true where id = $1 and superseded_at is null`,
            [published.id],
          ),
        );
        const mutated = await asUser(() => service.findOne(published.id));
        expect(Number(mutated.average_percentage)).toBe(100);
      } finally {
        conn.release();
      }
    });
  });
});
