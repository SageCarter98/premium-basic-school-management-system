/**
 * worker.ts — the "dedicated worker pool" FR-JOB-020 requires ("never on
 * request-serving capacity"). This is a genuinely separate Node process:
 * it never imports NestFactory.create()/app.listen(), so it structurally
 * cannot serve an HTTP request — a real, checkable property, not just a
 * documented intent (`npm run worker` / `npm run worker:dev`, distinct
 * from `npm run start` / `start:dev`).
 *
 * Two independent polling loops, both against real Postgres, no in-memory
 * queue of any kind (a second worker process, or a restart mid-run, picks
 * up exactly where the crashed/stopped one left off — every bit of state
 * lives in background_jobs/job_schedules, never in this process):
 *   - dequeue loop: claims and runs one due job at a time via
 *     dequeue_next_job() (pbsms_worker, SECURITY DEFINER — see
 *     0027_background_jobs.sql's header for why a plain grant wouldn't
 *     work), dispatches by job_type to a handler, records the outcome via
 *     complete_job().
 *   - schedule loop: calls evaluate_due_schedules() on a slower interval to
 *     turn due job_schedules rows into new background_jobs rows.
 *
 * Job execution needs TWO pools, connecting as two different roles:
 * WORKER_POOL (pbsms_worker) only ever touches the three SECURITY DEFINER
 * functions above; actual job business logic (creating generated_documents/
 * notifications rows) goes through a WorkerTenantConnection wrapping a
 * client from the ordinary DATABASE_URL pool (pbsms_app) — the same role
 * and same tables the HTTP app already uses, just without an HTTP request
 * driving it.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import 'reflect-metadata';
import { Pool } from 'pg';
import { WorkerTenantConnection } from './common/database/worker-tenant-connection';
import { TenantContextStore } from './common/tenant/tenant-context';
import { handleReportCardBatch, ReportCardBatchPayload } from './jobs-worker/handlers/report-card-batch.handler';
import { handleMassNotification, MassNotificationPayload } from './jobs-worker/handlers/mass-notification.handler';
import { handleDunningNotification, DunningNotificationPayload } from './jobs-worker/handlers/dunning-notification.handler';
import { handleKpiCompute, KpiComputePayload } from './jobs-worker/handlers/kpi-compute.handler';
import { computeAndStoreFeedbackDigest } from './jobs-worker/handlers/product-feedback-digest.handler';

config({ path: resolve(__dirname, '../../../.env') });

// The system service account (0027_background_jobs.sql) — used as the
// TenantContextStore actor only when a job carries no real human
// created_by (currently just platform-triggered 'dunning_notification'
// jobs). Every other job type's created_by is a real user, carried
// through from whoever enqueued it or owns the schedule that did.
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000001';

const DEQUEUE_POLL_MS = Number(process.env.WORKER_DEQUEUE_POLL_MS ?? 2000);
const SCHEDULE_POLL_MS = Number(process.env.WORKER_SCHEDULE_POLL_MS ?? 60000);
// EC-100/101's product-feedback digest (0048) — a genuinely separate
// timer, not part of the dequeue/schedule loops above. Those two are
// built around background_jobs/job_schedules, both per-tenant RLS'd
// tables; product_feedback has no tenant_id at all (0046's whole point),
// so there's nothing to dequeue or schedule per-tenant here. Defaults to
// once a day — feedback volume doesn't need anything tighter, and the
// handler itself skips writing a row when nothing's new since last run.
const FEEDBACK_DIGEST_POLL_MS = Number(process.env.WORKER_FEEDBACK_DIGEST_POLL_MS ?? 86400000);

type JobRow = {
  id: string;
  tenant_id: string;
  job_type: string;
  payload: unknown;
  attempt_count: number;
  max_attempts: number;
  created_by: string | null;
};

async function runHandler(job: JobRow, appPool: Pool): Promise<void> {
  const conn = new WorkerTenantConnection(appPool);
  try {
    await TenantContextStore.run(
      { tenantId: job.tenant_id, isPlatformUser: false, userId: job.created_by ?? SYSTEM_ACTOR_ID, roles: [] },
      async () => {
        switch (job.job_type) {
          case 'report_card_batch':
            await handleReportCardBatch(job.payload as ReportCardBatchPayload, conn, appPool);
            return;
          case 'mass_notification':
            await handleMassNotification(job.payload as MassNotificationPayload, conn);
            return;
          case 'dunning_notification':
            await handleDunningNotification(job.payload as DunningNotificationPayload, conn);
            return;
          case 'kpi_compute':
            await handleKpiCompute(job.payload as KpiComputePayload, conn);
            return;
          default:
            throw new Error(`No handler registered for job_type '${job.job_type}'`);
        }
      },
    );
  } finally {
    conn.release();
  }
}

async function dequeueLoop(workerPool: Pool, appPool: Pool): Promise<void> {
  const { rows } = await workerPool.query<JobRow>('select * from dequeue_next_job()');
  if (rows.length === 0) return;
  const job = rows[0];

  // eslint-disable-next-line no-console
  console.log(`[worker] running job ${job.id} (${job.job_type}, tenant ${job.tenant_id}, attempt ${job.attempt_count}/${job.max_attempts})`);

  try {
    await runHandler(job, appPool);
    await workerPool.query('select complete_job($1, true, null)', [job.id]);
    // eslint-disable-next-line no-console
    console.log(`[worker] job ${job.id} succeeded`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await workerPool.query('select complete_job($1, false, $2)', [job.id, message]);
    // eslint-disable-next-line no-console
    console.error(`[worker] job ${job.id} failed: ${message}`);
  }
}

async function scheduleLoop(workerPool: Pool): Promise<void> {
  const { rows } = await workerPool.query<{ evaluate_due_schedules: number }>('select evaluate_due_schedules()');
  const count = rows[0]?.evaluate_due_schedules ?? 0;
  if (count > 0) {
    // eslint-disable-next-line no-console
    console.log(`[worker] evaluate_due_schedules() enqueued ${count} job(s)`);
  }
}

async function feedbackDigestLoop(workerPool: Pool): Promise<void> {
  const result = await computeAndStoreFeedbackDigest(workerPool);
  if (result.skipped) {
    // eslint-disable-next-line no-console
    console.log(`[worker] feedback digest skipped: ${result.reason}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `[worker] feedback digest ${result.digestId} written (${result.sourceReportCount} total reports, ${result.newReportCount} new)`,
    );
  }
}

async function bootstrap() {
  const workerPool = new Pool({
    connectionString: process.env.WORKER_DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 10),
  });
  const appPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 10),
  });

  // eslint-disable-next-line no-console
  console.log(
    `[worker] started — dequeue every ${DEQUEUE_POLL_MS}ms, schedules every ${SCHEDULE_POLL_MS}ms, feedback digest every ${FEEDBACK_DIGEST_POLL_MS}ms`,
  );

  let stopping = false;
  const dequeueTimer = setInterval(() => {
    if (stopping) return;
    dequeueLoop(workerPool, appPool).catch((err) => console.error('[worker] dequeue loop error', err));
  }, DEQUEUE_POLL_MS);
  const scheduleTimer = setInterval(() => {
    if (stopping) return;
    scheduleLoop(workerPool).catch((err) => console.error('[worker] schedule loop error', err));
  }, SCHEDULE_POLL_MS);
  const feedbackDigestTimer = setInterval(() => {
    if (stopping) return;
    feedbackDigestLoop(workerPool).catch((err) => console.error('[worker] feedback digest loop error', err));
  }, FEEDBACK_DIGEST_POLL_MS);

  const shutdown = async () => {
    stopping = true;
    clearInterval(dequeueTimer);
    clearInterval(scheduleTimer);
    clearInterval(feedbackDigestTimer);
    await Promise.all([workerPool.end(), appPool.end()]);
    // eslint-disable-next-line no-console
    console.log('[worker] shut down cleanly');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();
