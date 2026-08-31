/**
 * jobs.e2e-spec.ts
 *
 * Chapter 35.1, the tenant-facing half of FR-JOB-010..030 (background
 * jobs and recurring schedules) — genuinely untested before this file (no
 * existing suite constructs JobsService).
 *
 * JobsService's own header comment is explicit that it's only half the
 * picture: enqueueing/reading jobs and schedules through the ordinary
 * pbsms_app/RLS path. The OTHER half — actually running a job — lives in
 * src/worker.ts, a genuinely separate process reaching background_jobs/
 * job_schedules through pbsms_worker's SECURITY DEFINER functions. That
 * means FR-JOB-020 ("never on request-serving capacity", an architectural
 * property of worker.ts existing as its own process) and the execution-
 * time half of FR-JOB-030 (started_at/completed_at/outcome/retry count/
 * dead-letter, all set once a job actually runs) are outside what a
 * JobsService-level suite can test — this file covers only the creation-
 * time half FR-JOB-030 names (tenant_id, created_by) and the FR-JOB-010
 * schedule shape, both of which are genuinely this service's own logic.
 *
 * Harness pattern copied from results-immutability.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom. NOT the same
 * afterAll cleanup, though: 0027_background_jobs.sql's grant to
 * pbsms_app is `select, insert, update` only — no delete — so nothing
 * this file creates in background_jobs/job_schedules can be cleaned up
 * by the app role at all; deliberate, not an oversight (dequeue_next_job()
 * accesses this table via a SECURITY DEFINER function instead, bypassing
 * the app role's grants entirely). Fixture rows are left in place.
 *
 * Requires a running Postgres with every migration through
 * 0027_background_jobs.sql (and everything seed_demo.sql needs) already
 * applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { JobsService } from '../src/modules/jobs/jobs.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

function asUser<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

describe('Background jobs (Chapter 35.1, tenant-facing half of FR-JOB-010..030)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  function harness(): { conn: WorkerTenantConnection; service: JobsService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new JobsService(conn) };
  }

  describe('enqueue() — creation-time half of FR-JOB-030', () => {
    it('defaults scheduled_for to "now" when omitted, and records the creating tenant/user', async () => {
      const { conn, service } = harness();
      try {
        const before = new Date();
        const job = await asUser(() => service.enqueue({ jobType: 'kpi_compute' } as never));

        expect(job.tenant_id).toBe(TENANT_A);
        expect(job.created_by).toBe(HEADMASTER);
        expect(job.status).toBe('queued');
        expect(new Date(job.scheduled_for).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      } finally {
        conn.release();
      }
    });

    it('honours an explicit scheduledFor rather than defaulting it', async () => {
      const { conn, service } = harness();
      try {
        const future = new Date(Date.now() + 3600_000).toISOString();
        const job = await asUser(() =>
          service.enqueue({ jobType: 'mass_notification', scheduledFor: future } as never),
        );
        expect(new Date(job.scheduled_for).toISOString()).toBe(future);
      } finally {
        conn.release();
      }
    });
  });

  describe('findAll(status) — filtering', () => {
    it('returns only jobs matching the given status, and everything when status is omitted', async () => {
      const { conn, service } = harness();
      try {
        const job = await asUser(() => service.enqueue({ jobType: 'kpi_compute' } as never));

        const queued = await asUser(() => service.findAll('queued'));
        expect(queued.map((j) => j.id)).toContain(job.id);

        const running = await asUser(() => service.findAll('running'));
        expect(running.map((j) => j.id)).not.toContain(job.id);

        const all = await asUser(() => service.findAll());
        expect(all.map((j) => j.id)).toContain(job.id);
      } finally {
        conn.release();
      }
    });
  });

  describe('schedules — FR-JOB-010', () => {
    it('creates a recurring schedule and deactivates it, 404ing for an unknown id', async () => {
      const { conn, service } = harness();
      try {
        const schedule = await asUser(() =>
          service.createSchedule({
            jobType: 'report_card_batch',
            frequency: 'termly',
            nextRunAt: new Date(Date.now() + 86400_000).toISOString(),
          } as never),
        );
        expect(schedule.frequency).toBe('termly');
        expect(schedule.is_active).toBe(true);

        const all = await asUser(() => service.findAllSchedules());
        expect(all.map((s) => s.id)).toContain(schedule.id);

        const deactivated = await asUser(() => service.deactivateSchedule(schedule.id));
        expect(deactivated.is_active).toBe(false);

        await expect(
          asUser(() => service.deactivateSchedule('00000000-0000-0000-0000-000000000000')),
        ).rejects.toThrow(/not found/);
      } finally {
        conn.release();
      }
    });
  });
});
