import { IsIn, IsISO8601, IsObject, IsOptional } from 'class-validator';

/** create-job.dto.ts — FR-JOB-020's named examples. 'dunning_notification'
 * is deliberately NOT listed here: it's only ever created internally via
 * platform_enqueue_job() (billing.service.ts's runDunningStep()), never
 * tenant-self-service. 'bulk_import' from Chapter 35.1's own text is also
 * deliberately excluded — no import format/mapping exists anywhere in this
 * codebase yet (a separate, unscoped feature), so allowing that job_type
 * here would accept jobs no handler could ever run. */
const TENANT_ENQUEUEABLE_JOB_TYPES = ['report_card_batch', 'mass_notification', 'kpi_compute'];

export class CreateJobDto {
  @IsIn(TENANT_ENQUEUEABLE_JOB_TYPES)
  jobType!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  /** Omit to run as soon as the worker picks it up. */
  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;
}
