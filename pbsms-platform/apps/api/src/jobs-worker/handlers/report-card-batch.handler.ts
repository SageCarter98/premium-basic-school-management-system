/**
 * report-card-batch.handler.ts — FR-JOB-020's named example, and
 * NFR-PERF-024 ("report-card batch generation, 500 students, 5 minutes, as
 * a background job with progress indication"). Reuses
 * DocumentsService.generateReportCard() unchanged — one call per current,
 * approved student_results row in the target class+year — rather than
 * duplicating its content-assembly logic. `progress indication` is
 * satisfied by leaving each already-generated document queryable via the
 * normal GET /v1/documents as the batch runs, not a separate progress
 * field on background_jobs — a caller can already see partial completion
 * that way.
 *
 * Batch semantics: one failing student must not abort the rest (same
 * per-item-outcome shape attendance.service.ts's sync() uses, not
 * FR-ASM-020's throw-on-first-problem shape) — a single malformed result
 * shouldn't cost the other 499 students their report cards.
 */

import { Pool } from 'pg';
import { DocumentsService } from '../../modules/documents/documents.service';
import { NaccaService } from '../../modules/nacca/nacca.service';
import { WorkerTenantConnection } from '../../common/database/worker-tenant-connection';

const APPROVED_RESULT_STATUSES = ['published', 'locked', 'archived'];

export interface ReportCardBatchPayload {
  classId: string;
  academicYearId: string;
}

export async function handleReportCardBatch(
  payload: ReportCardBatchPayload,
  db: WorkerTenantConnection,
  pgPool: Pool,
): Promise<void> {
  // Excludes results that already have a non-revoked report_card
  // (idempotency on retry: complete_job() re-runs the whole handler on
  // failure, and generateReportCard() itself has no uniqueness constraint
  // stopping a second call for the same result — without this filter, a
  // partial-failure retry would re-generate cards for students who already
  // succeeded on the prior attempt).
  const resultRows = await db.query<{ id: string }>(
    `select sr.id from student_results sr
     where sr.class_id = $1 and sr.academic_year_id = $2
       and sr.status = any($3::text[]) and sr.superseded_at is null
       and not exists (
         select 1 from generated_documents gd
         where gd.student_result_id = sr.id and gd.document_type = 'report_card' and gd.revoked_at is null
       )`,
    [payload.classId, payload.academicYearId, APPROVED_RESULT_STATUSES],
  );

  if (resultRows.length === 0) {
    throw new Error(
      `No approved (published/locked/archived) current results found for class ${payload.classId}, year ${payload.academicYearId}`,
    );
  }

  const documents = new DocumentsService(db, pgPool, new NaccaService(db));
  const failures: string[] = [];

  for (const row of resultRows) {
    try {
      await documents.generateReportCard({ studentResultId: row.id });
    } catch (err) {
      failures.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length}/${resultRows.length} report cards failed: ${failures.join('; ')}`);
  }
}
