import { IsIn, IsISO8601, IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';

const TENANT_ENQUEUEABLE_JOB_TYPES = ['report_card_batch', 'mass_notification', 'kpi_compute'];
const FREQUENCIES = ['one_time', 'daily', 'weekly', 'monthly', 'termly', 'yearly'];

/** create-schedule.dto.ts — FR-JOB-010. `nextRunAt` is the caller-supplied
 * anchor for the FIRST run, given as an absolute UTC instant representing
 * the intended tenant-local wall-clock time (e.g. computed client-side, or
 * server-side against tenants.default_timezone) — this pass does not
 * implement general IANA timezone-aware recurrence math (a real, separate
 * feature), so every subsequent occurrence evaluate_due_schedules()
 * computes is a fixed calendar-interval offset from that anchor, not a
 * timezone-recalculated wall-clock time. Documented simplification, same
 * category as 'termly' standing in for a real terms table. */
export class CreateScheduleDto {
  @IsIn(TENANT_ENQUEUEABLE_JOB_TYPES)
  jobType!: string;

  @IsOptional()
  @IsObject()
  payloadTemplate?: Record<string, unknown>;

  @IsIn(FREQUENCIES)
  frequency!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @IsISO8601()
  nextRunAt!: string;
}
