/**
 * attendance.service.ts
 *
 * Implements SRS v2.1 Chapter 18 (FR-ATT-010..050). Same tenant-scoping
 * pattern as every other service here — no `tenant_id` in a WHERE/INSERT
 * by hand, RLS supplies it — but this is the first module whose core
 * operation, sync(), is designed around an offline client that hasn't been
 * built yet (see 0003_attendance.sql's header and README.md's "Where to go
 * next"). Every entry here is processed independently, not inside one
 * shared transaction like admissions.service.ts's convert() — a batch of
 * 50 offline-queued entries where one collides should apply the other 49,
 * not roll all of them back.
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { TeacherAssignmentsService } from '../teacher-assignments/teacher-assignments.service';
import { ACADEMIC_ADMIN } from '../../common/auth/role-groups';
import { SyncAttendanceEntryDto } from './dto/sync-attendance.dto';

export interface AttendanceRecord {
  id: string;
  tenant_id: string;
  student_id: string;
  class_id: string;
  attendance_date: string;
  session: string;
  status: string;
  client_id: string | null;
  device_timestamp: string;
  original_status: string | null;
  correction_reason: string | null;
  corrected_at: string | null;
  corrected_by: string | null;
  created_by: string | null;
}

export interface AttendanceConflict {
  id: string;
  tenant_id: string;
  attendance_record_id: string;
  incoming_status: string;
  incoming_device_timestamp: string;
  incoming_client_id: string | null;
  incoming_submitted_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
}

export type SyncEntryOutcome =
  | { outcome: 'created'; entry: SyncAttendanceEntryDto; record: AttendanceRecord }
  | { outcome: 'updated'; entry: SyncAttendanceEntryDto; record: AttendanceRecord }
  | { outcome: 'idempotent_replay'; entry: SyncAttendanceEntryDto; record: AttendanceRecord }
  | { outcome: 'superseded'; entry: SyncAttendanceEntryDto; record: AttendanceRecord }
  | { outcome: 'conflict'; entry: SyncAttendanceEntryDto; conflictId: string }
  | { outcome: 'forbidden'; entry: SyncAttendanceEntryDto; reason: string };

@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly teacherAssignments: TeacherAssignmentsService,
  ) {}

  /** FR-ATT-010: the one entry point both a connected UI (array of one) and
   * a future offline queue (a real batch) call. */
  async sync(entries: SyncAttendanceEntryDto[]): Promise<SyncEntryOutcome[]> {
    const { userId, roles } = TenantContextStore.current();
    // Chapter 13.3 "Assigned students" scope: computed once per batch, not
    // per entry — an ACADEMIC_ADMIN-tier caller (coordinator/headmaster)
    // overrides class-assignment scoping the same way FR-ASM-020's score
    // entry already does; a plain teacher does not.
    const isAcademicAdmin = roles.some((r) => (ACADEMIC_ADMIN as string[]).includes(r));
    const results: SyncEntryOutcome[] = [];
    for (const entry of entries) {
      results.push(await this.applyEntry(entry, userId, isAcademicAdmin));
    }
    return results;
  }

  private async applyEntry(
    entry: SyncAttendanceEntryDto,
    userId: string,
    isAcademicAdmin: boolean,
  ): Promise<SyncEntryOutcome> {
    if (!isAcademicAdmin) {
      const classRows = await this.db.query<{ academic_year_id: string }>(
        `select academic_year_id from classes where id = $1`,
        [entry.classId],
      );
      if (classRows.length === 0) {
        return { outcome: 'forbidden', entry, reason: `Class ${entry.classId} not found` };
      }
      const assigned = await this.teacherAssignments.hasAnyActiveAssignmentForClass(
        userId,
        entry.classId,
        classRows[0].academic_year_id,
      );
      if (!assigned) {
        return {
          outcome: 'forbidden',
          entry,
          reason: `You do not have an active teacher assignment for class ${entry.classId}`,
        };
      }
    }

    const session = entry.session ?? 'full_day';
    // A directly-connected client has no meaningful device/server clock
    // skew to record, so this defaults to server-receipt time. An offline
    // client MUST always send its own device_timestamp — that is the
    // whole point of FR-ATT-011's comparison.
    const deviceTimestamp = entry.deviceTimestamp ?? new Date().toISOString();

    if (entry.clientId) {
      const replay = await this.db.query<AttendanceRecord>(
        `select * from attendance_records where client_id = $1`,
        [entry.clientId],
      );
      if (replay.length > 0) {
        return { outcome: 'idempotent_replay', entry, record: replay[0] };
      }
    }

    const existingRows = await this.db.query<AttendanceRecord>(
      `select * from attendance_records
       where student_id = $1 and class_id = $2 and attendance_date = $3 and session = $4
         and deleted_at is null`,
      [entry.studentId, entry.classId, entry.attendanceDate, session],
    );

    if (existingRows.length === 0) {
      const rows = await this.db.query<AttendanceRecord>(
        `insert into attendance_records
           (tenant_id, student_id, class_id, attendance_date, session, status, client_id, device_timestamp, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $8)
         returning *`,
        [
          entry.studentId,
          entry.classId,
          entry.attendanceDate,
          session,
          entry.status,
          entry.clientId ?? null,
          deviceTimestamp,
          userId,
        ],
      );
      return { outcome: 'created', entry, record: rows[0] };
    }

    const existing = existingRows[0];

    if (existing.created_by === userId) {
      // FR-ATT-011, first half: same user across devices — last-write-wins
      // by DEVICE timestamp (never server receipt order, which an offline
      // queue can reorder arbitrarily).
      if (new Date(deviceTimestamp).getTime() > new Date(existing.device_timestamp).getTime()) {
        const rows = await this.db.query<AttendanceRecord>(
          `update attendance_records
           set status = $1, client_id = coalesce($2, client_id), device_timestamp = $3, updated_by = $4
           where id = $5
           returning *`,
          [entry.status, entry.clientId ?? null, deviceTimestamp, userId, existing.id],
        );
        return { outcome: 'updated', entry, record: rows[0] };
      }
      return { outcome: 'superseded', entry, record: existing };
    }

    // FR-ATT-011, second half: different user, same key — surfaced for
    // manual reconciliation, never silently overwritten.
    const conflictRows = await this.db.query<{ id: string }>(
      `insert into attendance_conflicts
         (tenant_id, attendance_record_id, incoming_status, incoming_device_timestamp, incoming_client_id, incoming_submitted_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5)
       returning id`,
      [existing.id, entry.status, deviceTimestamp, entry.clientId ?? null, userId],
    );
    return { outcome: 'conflict', entry, conflictId: conflictRows[0].id };
  }

  async findAll(): Promise<AttendanceRecord[]> {
    return this.db.query<AttendanceRecord>(
      `select * from attendance_records where deleted_at is null order by attendance_date desc`,
    );
  }

  async findOne(id: string): Promise<AttendanceRecord> {
    const rows = await this.db.query<AttendanceRecord>(
      `select * from attendance_records where id = $1 and deleted_at is null`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Attendance record ${id} not found`);
    }
    return rows[0];
  }

  /** FR-ATT-030: retains both the original and corrected values. */
  async correct(id: string, status: string, reason: string): Promise<AttendanceRecord> {
    const { userId } = TenantContextStore.current();
    const existing = await this.findOne(id);
    const rows = await this.db.query<AttendanceRecord>(
      `update attendance_records
       set status = $1,
           original_status = coalesce(original_status, $2),
           correction_reason = $3,
           corrected_at = now(),
           corrected_by = $4,
           updated_by = $4
       where id = $5
       returning *`,
      [status, existing.status, reason, userId, id],
    );
    return rows[0];
  }

  async findConflicts(): Promise<AttendanceConflict[]> {
    return this.db.query<AttendanceConflict>(
      `select * from attendance_conflicts where resolved_at is null order by created_at`,
    );
  }

  /** FR-ATT-011: a reviewer picks a side; nothing is ever auto-merged. */
  async resolveConflict(id: string, resolution: string): Promise<AttendanceConflict> {
    const { userId } = TenantContextStore.current();
    const conflictRows = await this.db.query<AttendanceConflict>(
      `select * from attendance_conflicts where id = $1`,
      [id],
    );
    if (conflictRows.length === 0) {
      throw new NotFoundException(`Conflict ${id} not found`);
    }
    const conflict = conflictRows[0];
    if (conflict.resolved_at) {
      throw new ConflictException(`Conflict ${id} is already resolved`);
    }

    if (resolution === 'applied_incoming') {
      await this.db.query(
        `update attendance_records
         set status = $1, device_timestamp = $2, client_id = coalesce($3, client_id), updated_by = $4
         where id = $5`,
        [
          conflict.incoming_status,
          conflict.incoming_device_timestamp,
          conflict.incoming_client_id,
          userId,
          conflict.attendance_record_id,
        ],
      );
    }

    const rows = await this.db.query<AttendanceConflict>(
      `update attendance_conflicts set resolved_at = now(), resolved_by = $1, resolution = $2 where id = $3 returning *`,
      [userId, resolution, id],
    );
    return rows[0];
  }
}
