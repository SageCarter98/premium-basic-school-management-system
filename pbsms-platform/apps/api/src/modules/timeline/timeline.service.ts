/**
 * timeline.service.ts — Student Profile's Timeline tab (spec §7.5). No
 * new table: a chronological merge of events already owned by other
 * modules' services, reusing their existing find-all methods (the same
 * cross-module-DI pattern parent-view.service.ts established for
 * ResultsService/FinanceService — see that module's header) rather than
 * querying their tables directly.
 *
 * Access control is per EVENT CATEGORY, not just "can view this student":
 * Finance and Health are role-restricted tabs in their own right
 * (finance.controller.ts's READ_ROLES, health.controller.ts's
 * HEALTH_TEAM) — a caller without that tier must not see those events
 * merged into an otherwise-visible Timeline just because the Timeline
 * endpoint itself is ALL_STAFF. Categories are silently omitted, not
 * 403'd, matching how the frontend's own tab-level RestrictedState works
 * elsewhere (a viewer who can't see Finance shouldn't even know whether
 * this student HAS invoices).
 */

import { Injectable } from '@nestjs/common';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { ACADEMIC_STAFF, LEADERSHIP } from '../../common/auth/role-groups';
import { AttendanceService } from '../attendance/attendance.service';
import { ResultsService } from '../results/results.service';
import { DisciplineService } from '../discipline/discipline.service';
import { HealthService } from '../health/health.service';
import { FinanceService } from '../finance/finance.service';

// Mirrors finance.controller.ts's own READ_ROLES / health.controller.ts's
// HEALTH_TEAM exactly (not imported — those are controller-local consts,
// not role-groups.ts exports) so a Timeline entry only ever appears for a
// caller who could also reach that data via its own tab.
const FINANCE_READERS = [...LEADERSHIP, 'accountant'];
const HEALTH_READERS = [...LEADERSHIP, 'health_officer'];

export interface TimelineEvent {
  type: 'attendance' | 'result' | 'discipline' | 'finance' | 'health';
  date: string;
  summary: string;
}

function hasAny(roles: string[], tier: string[]): boolean {
  return roles.some((r) => tier.includes(r));
}

@Injectable()
export class TimelineService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly results: ResultsService,
    private readonly discipline: DisciplineService,
    private readonly health: HealthService,
    private readonly finance: FinanceService,
  ) {}

  async getTimeline(studentId: string): Promise<TimelineEvent[]> {
    const { roles } = TenantContextStore.current();
    const events: TimelineEvent[] = [];

    if (hasAny(roles, ACADEMIC_STAFF)) {
      const [attendanceAll, disciplineAll, resultsPublished] = await Promise.all([
        this.attendance.findAll(),
        this.discipline.findAllCases(),
        this.results.findPublishedForStudentAsStaff(studentId),
      ]);
      for (const a of attendanceAll) {
        if (a.student_id !== studentId || a.status === 'present') continue;
        events.push({ type: 'attendance', date: a.attendance_date, summary: `Marked ${a.status.replace('_', ' ')}` });
      }
      for (const c of disciplineAll) {
        if (c.student_id !== studentId) continue;
        events.push({ type: 'discipline', date: c.incident_date, summary: `Discipline case (${c.category}, ${c.severity}) — ${c.status}` });
      }
      for (const r of resultsPublished) {
        if (!r.published_at) continue;
        events.push({ type: 'result', date: r.published_at, summary: `Result published — ${r.overall_pass ? 'pass' : 'fail'}` });
      }
    }

    if (hasAny(roles, FINANCE_READERS)) {
      const [invoicesAll, paymentsAll] = await Promise.all([this.finance.findAllInvoices(), this.finance.findAllPayments()]);
      for (const inv of invoicesAll) {
        if (inv.student_id !== studentId) continue;
        events.push({ type: 'finance', date: inv.issued_at, summary: `Invoice ${inv.invoice_number} issued — ${inv.status}` });
      }
      for (const p of paymentsAll) {
        if (p.student_id !== studentId) continue;
        events.push({ type: 'finance', date: p.received_at, summary: `Payment received (${p.method}) — ${p.status}` });
      }
    }

    if (hasAny(roles, HEALTH_READERS)) {
      const incidentsAll = await this.health.findAllIncidents();
      for (const h of incidentsAll) {
        if (h.student_id !== studentId) continue;
        events.push({ type: 'health', date: h.incident_date, summary: `Health incident (${h.severity}) — ${h.status}` });
      }
    }

    return events.sort((a, b) => (a.date < b.date ? 1 : -1));
  }
}
