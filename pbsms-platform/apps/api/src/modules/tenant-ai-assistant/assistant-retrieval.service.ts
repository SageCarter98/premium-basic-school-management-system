import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { TeacherAssignmentsService } from '../teacher-assignments/teacher-assignments.service';
import { assertCategoryAllowed, AssistantCategory } from './assistant-categories';
import { AssistantInteractionLogger } from './assistant-interaction-logger.service';
import { AssistantSettingsService } from './assistant-settings.service';
import { FindLowAttendanceDto } from './dto/find-low-attendance.dto';

export interface AssistantRecordRef {
  recordType: 'student' | 'class';
  recordId: string; // FR-AIT-011: navigable/traceable identifier
}

export interface LowAttendanceRow {
  studentId: string;
  studentFirstName: string; // DP-102: minimal projection, not the full student profile
  studentLastName: string;
  classId: string;
  className: string;
  presentDays: number;
  totalDays: number;
  attendancePercentage: number;
  refs: AssistantRecordRef[];
}

export interface AssistantRecordSet<T> {
  records: T[];
  totalCount: number; // FR-AIT-012
  truncated: boolean; // FR-AIT-012
}

const MAX_RECORDS = 50;

/**
 * Chapter 47 stage 1 (§47.0.2): retrieval under RLS, scope enforcement,
 * audit logging — no model in the loop. §47.3.1's worked example
 * (attendance below a threshold) is the vertical slice: `attendance_records`
 * already has Chapter-13.3 scope wired end-to-end via
 * TeacherAssignmentsService.getCallerScope(), reused here rather than
 * reimplemented.
 */
@Injectable()
export class AssistantRetrievalService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly teacherAssignments: TeacherAssignmentsService,
    private readonly settings: AssistantSettingsService,
    private readonly interactionLogger: AssistantInteractionLogger,
  ) {}

  async findLowAttendance(input: FindLowAttendanceDto): Promise<AssistantRecordSet<LowAttendanceRow>> {
    const category: AssistantCategory = 'attendance_below_threshold';
    try {
      assertCategoryAllowed(category); // DP-100
      await this.assertNotImpersonating(); // TEN-055
      await this.settings.assertEnabledForCaller(); // tenant-admin disable NFR
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'denied';
      await this.interactionLogger.log({ category, input, resultCount: 0, recordIds: [], denied: { reason } });
      throw err;
    }

    // TEN-051: reuse, don't reimplement, Chapter 13.3 scope.
    const scope = await this.teacherAssignments.getCallerScope();
    const params: unknown[] = [input.thresholdPercentage, input.startDate, input.endDate];
    let classFilter = '';
    if (!scope.unrestricted) {
      if (scope.classIds.size === 0) {
        await this.interactionLogger.log({ category, input, resultCount: 0, recordIds: [] });
        return { records: [], totalCount: 0, truncated: false };
      }
      params.push([...scope.classIds]);
      classFilter = `and ar.class_id = any($${params.length}::uuid[])`;
    }
    if (input.classId) {
      params.push(input.classId);
      classFilter += ` and ar.class_id = $${params.length}`;
    }

    // TEN-050: this.db is the same request-scoped TenantDatabaseService
    // every other module uses — RLS applies exactly as it would to any
    // other request; no elevated/service-account connection exists here.
    const rows = await this.db.query<LowAttendanceRow & { totalHits: number }>(
      `select s.id as "studentId", s.first_name as "studentFirstName", s.last_name as "studentLastName",
              ar.class_id as "classId", c.name as "className",
              count(*) filter (where ar.status = 'present') as "presentDays",
              count(*) as "totalDays",
              round(100.0 * count(*) filter (where ar.status = 'present') / count(*), 1) as "attendancePercentage",
              count(*) over () as "totalHits"
       from attendance_records ar
       join students s on s.id = ar.student_id
       join classes c on c.id = ar.class_id
       where ar.attendance_date between $2 and $3 and ar.deleted_at is null ${classFilter}
       group by s.id, s.first_name, s.last_name, ar.class_id, c.name
       having round(100.0 * count(*) filter (where ar.status = 'present') / count(*), 1) < $1
       order by "attendancePercentage" asc
       limit ${MAX_RECORDS + 1}`,
      params,
    );

    const truncated = rows.length > MAX_RECORDS;
    const records = rows.slice(0, MAX_RECORDS).map((r) => ({
      ...r,
      refs: [
        { recordType: 'student' as const, recordId: r.studentId },
        { recordType: 'class' as const, recordId: r.classId },
      ],
    }));
    // count(*) over () comes back from pg as a bigint, which node-postgres
    // returns as a string rather than silently losing precision above
    // Number.MAX_SAFE_INTEGER — safe to parse here since a request-count
    // this small never approaches that bound.
    const totalCount = rows[0] ? Number(rows[0].totalHits) : 0;

    await this.interactionLogger.log({
      category,
      input,
      resultCount: records.length,
      recordIds: records.flatMap((r) => [r.studentId, r.classId]),
    });

    return { records, totalCount, truncated };
  }

  private async assertNotImpersonating(): Promise<void> {
    const { impersonationGrantId } = TenantContextStore.current();
    if (impersonationGrantId) {
      throw new ForbiddenException('The Assistant is disabled for impersonation sessions (TEN-055).');
    }
  }
}
