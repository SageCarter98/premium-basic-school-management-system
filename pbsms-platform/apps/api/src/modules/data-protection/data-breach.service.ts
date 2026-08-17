/**
 * data-breach.service.ts
 *
 * Implements DP-040 (personal data breach assessment/DPC reporting) — the
 * platform-scoped half of Chapter 39, since breach assessment and
 * regulator reporting is a company-level obligation (DP-010), not owned
 * by any single tenant. Uses PLATFORM_POOL directly, same pattern
 * tenants.service.ts/billing.service.ts already established — no
 * per-request tenant variable to set for a table TEN-005 exempts from
 * tenant scoping.
 */

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PLATFORM_POOL } from '../../common/database/database.module';
import { ReportBreachDto } from './dto/report-breach.dto';

const ASSESSMENT_WINDOW_HOURS = 24; // DP-040's literal 24-hour assessment deadline

export interface DataBreachIncident {
  id: string;
  detected_at: string;
  detected_by: string | null;
  assessment_deadline: string;
  assessed_at: string | null;
  assessed_by: string | null;
  meets_statutory_threshold: boolean | null;
  reported_to_dpc_at: string | null;
  affected_tenant_ids: string[];
  description: string;
  status: string;
}

@Injectable()
export class DataBreachService {
  constructor(@Inject(PLATFORM_POOL) private readonly pool: Pool) {}

  async report(actorId: string, input: ReportBreachDto): Promise<DataBreachIncident> {
    const result = await this.pool.query<DataBreachIncident>(
      `insert into data_breach_incidents (detected_by, assessment_deadline, affected_tenant_ids, description, created_by)
       values ($1, now() + interval '${ASSESSMENT_WINDOW_HOURS} hours', $2, $3, $1)
       returning *`,
      [actorId, input.affectedTenantIds ?? [], input.description],
    );
    return result.rows[0];
  }

  async findAll(): Promise<DataBreachIncident[]> {
    const result = await this.pool.query<DataBreachIncident>(`select * from data_breach_incidents order by detected_at desc`);
    return result.rows;
  }

  async findOne(id: string): Promise<DataBreachIncident> {
    const result = await this.pool.query<DataBreachIncident>(`select * from data_breach_incidents where id = $1`, [id]);
    if (result.rows.length === 0) {
      throw new NotFoundException(`Data breach incident ${id} not found`);
    }
    return result.rows[0];
  }

  async assess(actorId: string, id: string, meetsStatutoryThreshold: boolean): Promise<DataBreachIncident> {
    const incident = await this.findOne(id);
    if (incident.status !== 'detected') {
      throw new ConflictException(`Incident ${id} is '${incident.status}' — assess() only applies to a freshly 'detected' incident`);
    }
    const result = await this.pool.query<DataBreachIncident>(
      `update data_breach_incidents
       set status = 'assessing', assessed_at = now(), assessed_by = $2, meets_statutory_threshold = $3
       where id = $1 returning *`,
      [id, actorId, meetsStatutoryThreshold],
    );
    return result.rows[0];
  }

  /** DP-040: "reported... to the Data Protection Commission and affected
   * tenants without undue delay" once the statutory threshold is met.
   * Real DPC submission is an external regulatory filing, not an API call
   * this platform can make — this records the fact and timestamp of that
   * filing having happened, the same "the mechanism is real, the external
   * channel is out of scope" split every vendor-gated integration in this
   * codebase already uses. */
  async reportToDpc(id: string): Promise<DataBreachIncident> {
    const incident = await this.findOne(id);
    if (incident.status !== 'assessing') {
      throw new ConflictException(`Incident ${id} is '${incident.status}' — must be assessed before reporting to the DPC`);
    }
    if (!incident.meets_statutory_threshold) {
      throw new ConflictException(`Incident ${id} was assessed as not meeting the statutory reporting threshold`);
    }
    const result = await this.pool.query<DataBreachIncident>(
      `update data_breach_incidents set status = 'reported', reported_to_dpc_at = now() where id = $1 returning *`,
      [id],
    );
    return result.rows[0];
  }

  async close(id: string): Promise<DataBreachIncident> {
    const incident = await this.findOne(id);
    if (incident.status === 'closed') {
      throw new ConflictException(`Incident ${id} is already closed`);
    }
    const result = await this.pool.query<DataBreachIncident>(
      `update data_breach_incidents set status = 'closed' where id = $1 returning *`,
      [id],
    );
    return result.rows[0];
  }
}
