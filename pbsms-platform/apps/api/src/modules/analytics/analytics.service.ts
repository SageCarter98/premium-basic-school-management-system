/**
 * analytics.service.ts
 *
 * Implements SRS v2.1 Chapter 14 (Operational Intelligence Framework) —
 * the KPI Engine (14.2), Executive Dashboards / Group Roll-Up (14.3,
 * FR-ANL-010) and the buildable half of Chapter 27's trend analysis
 * (FR-ANL-020). See 0028_analytics.sql's header for what's deliberately
 * not built (AI summarization) and why `data_source` is a fixed set of
 * real calculators, not an executable formula string.
 *
 * All four calculators join through `students.school_id` to scope by
 * school — students carry their school directly (0001_init_tenancy.sql),
 * so this is the same one-hop join for collection_rate, attendance_rate
 * and academic_performance, rather than three different join shapes.
 * `outstanding_actions` is the one exception: notification_reports has no
 * school linkage at all (Chapter 26's design), so it is deliberately
 * tenant-wide only — reported once in the group roll-up, not per school.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { StaffService } from '../staff/staff.service';
import { CreateKpiDefinitionDto } from './dto/create-kpi-definition.dto';

export interface KpiDefinition {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  responsible_role: string;
  data_source: string;
  formula_description: string | null;
  target: string | null;
  weight: string | null;
  warning_threshold: string | null;
  critical_threshold: string | null;
  reporting_frequency: string;
  supervisor_user_id: string | null;
  status: string;
  school_id: string | null;
}

export interface KpiSnapshot {
  id: string;
  tenant_id: string;
  kpi_definition_id: string;
  school_id: string | null;
  period_start: string;
  period_end: string;
  value: string;
  status: string;
  computed_at: string;
}

export interface SchoolRollup {
  schoolId: string;
  schoolName: string;
  collectionRate: number;
  attendanceRate: number;
  academicPerformance: number | null;
}

export interface TrendPoint {
  academicYear: string;
  averagePercentage: number | null;
}

const APPROVED_RESULT_STATUSES = ['published', 'locked', 'archived'];

/** Higher value is better for these three; outstanding_actions is the one
 * lower-is-better data source (fewer open/overdue items is good). */
const HIGHER_IS_BETTER = new Set(['collection_rate', 'attendance_rate', 'academic_performance']);

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly staff: StaffService,
  ) {}

  // --------------------------------------------------------------------
  // KPI definitions (Chapter 14.2)
  // --------------------------------------------------------------------

  async createKpiDefinition(input: CreateKpiDefinitionDto): Promise<KpiDefinition> {
    const { userId } = TenantContextStore.current();
    if (input.supervisorUserId && !(await this.staff.isRealStaffMember(input.supervisorUserId))) {
      throw new NotFoundException(`supervisorUserId ${input.supervisorUserId} is not a real staff member of this tenant`);
    }
    const rows = await this.db.query<KpiDefinition>(
      `insert into kpi_definitions
         (tenant_id, code, name, responsible_role, data_source, formula_description, target, weight,
          warning_threshold, critical_threshold, reporting_frequency, supervisor_user_id, school_id,
          created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
       returning *`,
      [
        input.code,
        input.name,
        input.responsibleRole,
        input.dataSource,
        input.formulaDescription ?? null,
        input.target ?? null,
        input.weight ?? null,
        input.warningThreshold ?? null,
        input.criticalThreshold ?? null,
        input.reportingFrequency,
        input.supervisorUserId ?? null,
        input.schoolId ?? null,
        userId,
      ],
    );
    return rows[0];
  }

  async findAllKpiDefinitions(): Promise<KpiDefinition[]> {
    return this.db.query<KpiDefinition>(`select * from kpi_definitions order by code`);
  }

  async findOneKpiDefinition(id: string): Promise<KpiDefinition> {
    const rows = await this.db.query<KpiDefinition>(`select * from kpi_definitions where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`KPI definition ${id} not found`);
    }
    return rows[0];
  }

  // --------------------------------------------------------------------
  // Compute + snapshot (the "Reporting Engine" half of 14.1)
  // --------------------------------------------------------------------

  async recomputeKpi(id: string, periodStart: string, periodEnd: string): Promise<KpiSnapshot> {
    const { userId } = TenantContextStore.current();
    const def = await this.findOneKpiDefinition(id);
    const value = await this.computeValue(def.data_source, def.school_id, periodStart, periodEnd);
    const status = this.deriveStatus(def.data_source, value, def.warning_threshold, def.critical_threshold);

    const rows = await this.db.query<KpiSnapshot>(
      `insert into kpi_snapshots (tenant_id, kpi_definition_id, school_id, period_start, period_end, value, status, created_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [def.id, def.school_id, periodStart, periodEnd, value, status, userId],
    );
    return rows[0];
  }

  async findSnapshots(kpiDefinitionId: string): Promise<KpiSnapshot[]> {
    return this.db.query<KpiSnapshot>(
      `select * from kpi_snapshots where kpi_definition_id = $1 order by period_start desc`,
      [kpiDefinitionId],
    );
  }

  private async computeValue(
    dataSource: string,
    schoolId: string | null,
    periodStart: string,
    periodEnd: string,
  ): Promise<number> {
    switch (dataSource) {
      case 'collection_rate':
        return this.computeCollectionRate(schoolId, periodStart, periodEnd);
      case 'attendance_rate':
        return this.computeAttendanceRate(schoolId, periodStart, periodEnd);
      case 'academic_performance': {
        const avg = await this.computeAcademicPerformance(schoolId, periodStart, periodEnd);
        if (avg === null) {
          throw new Error('No approved results found for academic_performance in the requested period/scope');
        }
        return avg;
      }
      case 'outstanding_actions':
        return this.computeOutstandingActions();
      default:
        throw new Error(`No calculator for data_source '${dataSource}'`);
    }
  }

  private deriveStatus(
    dataSource: string,
    value: number,
    warningThreshold: string | null,
    criticalThreshold: string | null,
  ): 'on_target' | 'warning' | 'critical' {
    if (warningThreshold === null && criticalThreshold === null) return 'on_target';
    const warning = warningThreshold === null ? null : Number(warningThreshold);
    const critical = criticalThreshold === null ? null : Number(criticalThreshold);

    if (HIGHER_IS_BETTER.has(dataSource)) {
      if (critical !== null && value < critical) return 'critical';
      if (warning !== null && value < warning) return 'warning';
      return 'on_target';
    }
    // lower-is-better (outstanding_actions)
    if (critical !== null && value > critical) return 'critical';
    if (warning !== null && value > warning) return 'warning';
    return 'on_target';
  }

  /** FR-FIN's collection rate: allocated (non-reversed) payments over
   * invoiced amount, for invoices issued within the period — same
   * reversal-exclusion pattern finance.service.ts's own balance
   * calculations already use (`not exists ... reversals`), not
   * re-derived differently here. */
  private async computeCollectionRate(schoolId: string | null, periodStart: string, periodEnd: string): Promise<number> {
    const invoicedRows = await this.db.query<{ ids: string[] | null; total: string | null }>(
      `select array_agg(i.id) as ids, coalesce(sum(i.total_amount), 0) as total
       from invoices i
       join students s on s.id = i.student_id
       where i.status = 'posted' and i.issued_at::date between $1 and $2
         and ($3::uuid is null or s.school_id = $3)`,
      [periodStart, periodEnd, schoolId],
    );
    const invoiceIds = invoicedRows[0].ids ?? [];
    const invoiced = Number(invoicedRows[0].total ?? 0);
    if (invoiceIds.length === 0) return 0;

    const collectedRows = await this.db.query<{ total: string | null }>(
      `select coalesce(sum(pa.amount), 0) as total
       from payment_allocations pa
       where pa.invoice_id = any($1::uuid[])
         and not exists (select 1 from reversals r where r.reversed_entity_type = 'payment' and r.reversed_entity_id = pa.payment_id)`,
      [invoiceIds],
    );
    const collected = Number(collectedRows[0].total ?? 0);
    return invoiced === 0 ? 0 : Math.round((collected / invoiced) * 10000) / 100;
  }

  /** 'present' only counts as attended — 'late'/'excused'/'sick' etc. are
   * deliberately NOT counted as present, a documented modeling choice
   * (a school could reasonably want 'late' counted as attended instead;
   * nothing in FR-ATT names one way as correct). */
  private async computeAttendanceRate(schoolId: string | null, periodStart: string, periodEnd: string): Promise<number> {
    const rows = await this.db.query<{ present: string; total: string }>(
      `select
         count(*) filter (where ar.status = 'present') as present,
         count(*) as total
       from attendance_records ar
       join students s on s.id = ar.student_id
       where ar.attendance_date between $1 and $2
         and ($3::uuid is null or s.school_id = $3)`,
      [periodStart, periodEnd, schoolId],
    );
    const present = Number(rows[0].present);
    const total = Number(rows[0].total);
    return total === 0 ? 0 : Math.round((present / total) * 10000) / 100;
  }

  /** Averages the CURRENT (superseded_at is null), approved
   * (published/locked/archived) version of every result whose academic
   * year overlaps the requested period — there is no terms table
   * (documented gap since 0004/0020/0027), so "period" is matched
   * against the whole academic year rather than a specific term. */
  private async computeAcademicPerformance(
    schoolId: string | null,
    periodStart: string,
    periodEnd: string,
  ): Promise<number | null> {
    const rows = await this.db.query<{ avg: string | null }>(
      `select avg(sr.average_percentage) as avg
       from student_results sr
       join students s on s.id = sr.student_id
       join academic_years ay on ay.id = sr.academic_year_id
       where sr.status = any($1::text[]) and sr.superseded_at is null
         and ay.start_date <= $3 and (ay.end_date is null or ay.end_date >= $2)
         and ($4::uuid is null or s.school_id = $4)`,
      [APPROVED_RESULT_STATUSES, periodStart, periodEnd, schoolId],
    );
    return rows[0].avg === null ? null : Math.round(Number(rows[0].avg) * 100) / 100;
  }

  /** Tenant-wide only (see this file's header) — a live count as of now,
   * not period-bound, since "outstanding" is inherently a snapshot-in-time
   * concept, not something accumulated over a date range. */
  private async computeOutstandingActions(): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      `select count(*) as count from notification_reports where status <> 'completed'`,
    );
    return Number(rows[0].count);
  }

  // --------------------------------------------------------------------
  // Group roll-up (Chapter 14.3, FR-ANL-010)
  // --------------------------------------------------------------------

  async groupRollup(periodStart: string, periodEnd: string): Promise<{ schools: SchoolRollup[]; outstandingActionsCount: number }> {
    const schoolRows = await this.db.query<{ id: string; name: string }>(`select id, name from schools order by name`);
    const schools: SchoolRollup[] = [];
    for (const school of schoolRows) {
      const [collectionRate, attendanceRate, academicPerformance] = await Promise.all([
        this.computeCollectionRate(school.id, periodStart, periodEnd),
        this.computeAttendanceRate(school.id, periodStart, periodEnd),
        this.computeAcademicPerformance(school.id, periodStart, periodEnd),
      ]);
      schools.push({ schoolId: school.id, schoolName: school.name, collectionRate, attendanceRate, academicPerformance });
    }
    const outstandingActionsCount = await this.computeOutstandingActions();
    return { schools, outstandingActionsCount };
  }

  // --------------------------------------------------------------------
  // Trend analysis (Chapter 27.1, FR-ANL-020) — student/class/subject/
  // school level. 'division' from FR-ANL-020's own word list is
  // deliberately excluded: no division entity exists anywhere in this
  // schema to key a trend off of (documented gap, same category as
  // guardian/school-campus scoping's own unbuildable pieces).
  // --------------------------------------------------------------------

  async trendsByStudent(studentId: string): Promise<TrendPoint[]> {
    return this.db.query<TrendPoint>(
      `select ay.name as "academicYear", sr.average_percentage as "averagePercentage"
       from student_results sr
       join academic_years ay on ay.id = sr.academic_year_id
       where sr.student_id = $1 and sr.status = any($2::text[]) and sr.superseded_at is null
       order by ay.start_date asc`,
      [studentId, APPROVED_RESULT_STATUSES],
    );
  }

  /** classId identifies ONE year's class row (classes.academic_year_id is
   * part of its own uniqueness) — resolved to its name+school first, then
   * matched against every class of that same name+school across all
   * academic years, since a genuine "class trend" spans years a single
   * class_id cannot. */
  async trendsByClass(classId: string): Promise<TrendPoint[]> {
    const classRows = await this.db.query<{ name: string; school_id: string }>(
      `select c.name, ay.school_id
       from classes c join academic_years ay on ay.id = c.academic_year_id
       where c.id = $1`,
      [classId],
    );
    if (classRows.length === 0) {
      throw new NotFoundException(`Class ${classId} not found`);
    }
    const { name, school_id } = classRows[0];
    return this.db.query<TrendPoint>(
      `select ay.name as "academicYear", avg(sr.average_percentage) as "averagePercentage"
       from student_results sr
       join classes c on c.id = sr.class_id
       join academic_years ay on ay.id = c.academic_year_id
       where c.name = $1 and ay.school_id = $2 and sr.status = any($3::text[]) and sr.superseded_at is null
       group by ay.id, ay.name, ay.start_date
       order by ay.start_date asc`,
      [name, school_id, APPROVED_RESULT_STATUSES],
    );
  }

  async trendsBySubject(schoolId: string, subjectName: string): Promise<TrendPoint[]> {
    return this.db.query<TrendPoint>(
      `select ay.name as "academicYear", avg(sri.percentage) as "averagePercentage"
       from student_result_items sri
       join student_results sr on sr.id = sri.student_result_id
       join students s on s.id = sr.student_id
       join academic_years ay on ay.id = sr.academic_year_id
       where s.school_id = $1 and sri.subject_name = $2 and sr.status = any($3::text[]) and sr.superseded_at is null
       group by ay.id, ay.name, ay.start_date
       order by ay.start_date asc`,
      [schoolId, subjectName, APPROVED_RESULT_STATUSES],
    );
  }

  async trendsBySchool(schoolId: string): Promise<TrendPoint[]> {
    return this.db.query<TrendPoint>(
      `select ay.name as "academicYear", avg(sr.average_percentage) as "averagePercentage"
       from student_results sr
       join students s on s.id = sr.student_id
       join academic_years ay on ay.id = sr.academic_year_id
       where s.school_id = $1 and sr.status = any($2::text[]) and sr.superseded_at is null
       group by ay.id, ay.name, ay.start_date
       order by ay.start_date asc`,
      [schoolId, APPROVED_RESULT_STATUSES],
    );
  }
}
