/**
 * kpi-compute.handler.ts — the natural cross-cutting consumer linking
 * Phase D (background jobs) to Phase E (Chapter 14's KPI Engine): a
 * tenant can schedule a KPI's recompute via job_schedules ("recompute
 * this term's collection-rate KPI every month") instead of only ever
 * triggering it on demand through POST /v1/analytics/kpis/:id/recompute.
 * Reuses AnalyticsService.recomputeKpi() unchanged — same class, same
 * WorkerTenantConnection-instead-of-Scope.REQUEST pattern every other
 * handler in this directory already uses.
 */

import { AnalyticsService } from '../../modules/analytics/analytics.service';
import { StaffService } from '../../modules/staff/staff.service';
import { WorkerTenantConnection } from '../../common/database/worker-tenant-connection';

export interface KpiComputePayload {
  kpiDefinitionId: string;
  periodStart: string;
  periodEnd: string;
}

export async function handleKpiCompute(payload: KpiComputePayload, db: WorkerTenantConnection): Promise<void> {
  const analytics = new AnalyticsService(db, new StaffService(db));
  await analytics.recomputeKpi(payload.kpiDefinitionId, payload.periodStart, payload.periodEnd);
}
