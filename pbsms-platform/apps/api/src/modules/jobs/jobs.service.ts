/**
 * jobs.service.ts
 *
 * Implements the tenant-facing half of SRS v2.1 Chapter 35.1 (FR-JOB-010/
 * 020/030) — enqueueing/reading jobs and managing recurring schedules
 * through the ordinary pbsms_app / RLS path, same as any other module. The
 * OTHER half (actually running a job) is deliberately NOT here — it lives
 * in src/worker.ts, a genuinely separate process (FR-JOB-020: "never on
 * request-serving capacity"), which reaches background_jobs/job_schedules
 * through pbsms_worker's SECURITY DEFINER functions instead (see
 * 0027_background_jobs.sql's header for why a plain pbsms_worker grant
 * would not work — the same "RLS silently returns zero rows for a role
 * that never sets app.current_tenant" lesson Phase A2 already learned).
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';

export interface BackgroundJob {
  id: string;
  tenant_id: string;
  job_type: string;
  payload: unknown;
  status: string;
  scheduled_for: string;
  started_at: string | null;
  completed_at: string | null;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  created_by: string | null;
}

export interface JobSchedule {
  id: string;
  tenant_id: string;
  job_type: string;
  payload_template: unknown;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  next_run_at: string;
  last_run_at: string | null;
  is_active: boolean;
}

@Injectable()
export class JobsService {
  constructor(private readonly db: TenantDatabaseService) {}

  async enqueue(input: CreateJobDto): Promise<BackgroundJob> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<BackgroundJob>(
      `insert into background_jobs (tenant_id, job_type, payload, scheduled_for, created_by, updated_by)
       values (current_tenant_id(), $1, $2, coalesce($3, now()), $4, $4)
       returning *`,
      [input.jobType, input.payload ?? {}, input.scheduledFor ?? null, userId],
    );
    return rows[0];
  }

  async findAll(status?: string): Promise<BackgroundJob[]> {
    return this.db.query<BackgroundJob>(
      `select * from background_jobs where $1::text is null or status = $1 order by created_at desc`,
      [status ?? null],
    );
  }

  async findOne(id: string): Promise<BackgroundJob> {
    const rows = await this.db.query<BackgroundJob>(`select * from background_jobs where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Job ${id} not found`);
    }
    return rows[0];
  }

  async createSchedule(input: CreateScheduleDto): Promise<JobSchedule> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<JobSchedule>(
      `insert into job_schedules (tenant_id, job_type, payload_template, frequency, day_of_week, day_of_month, next_run_at, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $7)
       returning *`,
      [
        input.jobType,
        input.payloadTemplate ?? {},
        input.frequency,
        input.dayOfWeek ?? null,
        input.dayOfMonth ?? null,
        input.nextRunAt,
        userId,
      ],
    );
    return rows[0];
  }

  async findAllSchedules(): Promise<JobSchedule[]> {
    return this.db.query<JobSchedule>(`select * from job_schedules order by next_run_at asc`);
  }

  async deactivateSchedule(id: string): Promise<JobSchedule> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<JobSchedule>(
      `update job_schedules set is_active = false, updated_at = now(), updated_by = $2 where id = $1 returning *`,
      [id, userId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Schedule ${id} not found`);
    }
    return rows[0];
  }
}
