/**
 * timetable.service.ts
 *
 * Implements SRS v2.1 Chapter 17's Timetable builder/views (spec §7.6) and
 * FR-ACA-040 (teacher/class/room timetable-conflict detection) — see
 * 0033_timetable.sql's header for the schema shape and why the three
 * conflict rules are DB-enforced partial unique indexes, not a
 * BEGIN/COMMIT cross-row check.
 *
 * create() pre-checks each of the three conflicts explicitly (rather than
 * letting a unique-index violation surface as a raw 500) so the caller
 * gets a clean 409 naming exactly which of teacher/class/room collided —
 * the same "don't repeat the createFeeStructure() gap" reasoning
 * apps/web/README.md's Stage 7 section flagged.
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { CreateRoomDto } from './dto/create-room.dto';
import { CreatePeriodDto } from './dto/create-period.dto';
import { CreateTimetableEntryDto } from './dto/create-timetable-entry.dto';

export interface Room {
  id: string;
  tenant_id: string;
  name: string;
  capacity: number | null;
  status: string;
}

export interface Period {
  id: string;
  tenant_id: string;
  name: string;
  sequence: number;
  start_time: string;
  end_time: string;
  period_type: string;
}

export interface TimetableEntry {
  id: string;
  tenant_id: string;
  academic_year_id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  period_id: string;
  room_id: string | null;
  day_of_week: string;
  status: string;
  ended_at: string | null;
  ended_reason: string | null;
}

export interface TimetableEntryFilter {
  academicYearId?: string;
  classId?: string;
  teacherId?: string;
}

@Injectable()
export class TimetableService {
  constructor(private readonly db: TenantDatabaseService) {}

  // ---------------------------------------------------------------------
  // Rooms
  // ---------------------------------------------------------------------

  async createRoom(input: CreateRoomDto): Promise<Room> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<Room>(
      `insert into rooms (tenant_id, name, capacity, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $3)
       returning *`,
      [input.name, input.capacity ?? null, userId],
    );
    return rows[0];
  }

  async findAllRooms(): Promise<Room[]> {
    return this.db.query<Room>(`select * from rooms order by name`);
  }

  // ---------------------------------------------------------------------
  // Periods
  // ---------------------------------------------------------------------

  async createPeriod(input: CreatePeriodDto): Promise<Period> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<Period>(
      `insert into periods (tenant_id, name, sequence, start_time, end_time, period_type, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $6)
       returning *`,
      [input.name, input.sequence, input.startTime, input.endTime, input.periodType ?? 'teaching', userId],
    );
    return rows[0];
  }

  async findAllPeriods(): Promise<Period[]> {
    return this.db.query<Period>(`select * from periods order by sequence`);
  }

  // ---------------------------------------------------------------------
  // Timetable entries
  // ---------------------------------------------------------------------

  async createEntry(input: CreateTimetableEntryDto): Promise<TimetableEntry> {
    const { userId } = TenantContextStore.current();
    await this.assertIsTeacher(input.teacherId);
    await this.assertIsTeachingPeriod(input.periodId);

    const slot = { academicYearId: input.academicYearId, dayOfWeek: input.dayOfWeek, periodId: input.periodId };

    const teacherConflict = await this.findActiveEntry({ ...slot, teacherId: input.teacherId });
    if (teacherConflict) {
      throw new ConflictException(
        `Cannot create this timetable entry: teacher ${input.teacherId} already has an active entry ` +
          `at this ${input.dayOfWeek}/period slot (entry ${teacherConflict.id}).`,
      );
    }
    const classConflict = await this.findActiveEntry({ ...slot, classId: input.classId });
    if (classConflict) {
      throw new ConflictException(
        `Cannot create this timetable entry: class ${input.classId} already has an active entry ` +
          `at this ${input.dayOfWeek}/period slot (entry ${classConflict.id}).`,
      );
    }
    if (input.roomId) {
      const roomConflict = await this.findActiveEntry({ ...slot, roomId: input.roomId });
      if (roomConflict) {
        throw new ConflictException(
          `Cannot create this timetable entry: room ${input.roomId} is already booked ` +
            `at this ${input.dayOfWeek}/period slot (entry ${roomConflict.id}).`,
        );
      }
    }

    const rows = await this.db.query<TimetableEntry>(
      `insert into timetable_entries
         (tenant_id, academic_year_id, class_id, subject_id, teacher_id, period_id, room_id, day_of_week, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $8)
       returning *`,
      [
        input.academicYearId,
        input.classId,
        input.subjectId,
        input.teacherId,
        input.periodId,
        input.roomId ?? null,
        input.dayOfWeek,
        userId,
      ],
    );
    return rows[0];
  }

  async findAllEntries(filter: TimetableEntryFilter): Promise<TimetableEntry[]> {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.academicYearId) {
      params.push(filter.academicYearId);
      conditions.push(`academic_year_id = $${params.length}`);
    }
    if (filter.classId) {
      params.push(filter.classId);
      conditions.push(`class_id = $${params.length}`);
    }
    if (filter.teacherId) {
      params.push(filter.teacherId);
      conditions.push(`teacher_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
    return this.db.query<TimetableEntry>(
      `select * from timetable_entries ${where} order by day_of_week, created_at`,
      params,
    );
  }

  async findOne(id: string): Promise<TimetableEntry> {
    const rows = await this.db.query<TimetableEntry>(`select * from timetable_entries where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Timetable entry ${id} not found`);
    }
    return rows[0];
  }

  async end(id: string, reason?: string): Promise<TimetableEntry> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<TimetableEntry>(
      `update timetable_entries
       set status = 'ended', ended_at = now(), ended_reason = $2, updated_at = now(), updated_by = $3
       where id = $1 and status = 'active'
       returning *`,
      [id, reason ?? null, userId],
    );
    if (rows.length === 0) {
      await this.findOne(id); // 404s if it doesn't exist at all
      throw new ConflictException(`Timetable entry ${id} is already ended`);
    }
    return rows[0];
  }

  private async findActiveEntry(
    slot: { academicYearId: string; dayOfWeek: string; periodId: string } & (
      | { teacherId: string; classId?: undefined; roomId?: undefined }
      | { classId: string; teacherId?: undefined; roomId?: undefined }
      | { roomId: string; teacherId?: undefined; classId?: undefined }
    ),
  ): Promise<{ id: string } | null> {
    const column = slot.teacherId ? 'teacher_id' : slot.classId ? 'class_id' : 'room_id';
    const value = slot.teacherId ?? slot.classId ?? slot.roomId;
    const rows = await this.db.query<{ id: string }>(
      `select id from timetable_entries
       where ${column} = $1 and academic_year_id = $2 and day_of_week = $3 and period_id = $4 and status = 'active'
       limit 1`,
      [value, slot.academicYearId, slot.dayOfWeek, slot.periodId],
    );
    return rows[0] ?? null;
  }

  private async assertIsTeachingPeriod(periodId: string): Promise<void> {
    const rows = await this.db.query<{ period_type: string }>(`select period_type from periods where id = $1`, [
      periodId,
    ]);
    if (rows.length === 0) {
      throw new NotFoundException(`Period ${periodId} not found`);
    }
    if (rows[0].period_type !== 'teaching') {
      throw new ConflictException(
        `Cannot assign a class to period ${periodId}: it is a '${rows[0].period_type}' period, not 'teaching'.`,
      );
    }
  }

  private async assertIsTeacher(userId: string): Promise<void> {
    const rows = await this.db.query<{ hit: number }>(
      `select 1 as hit from tenant_users where user_id = $1 and role_code = 'teacher' limit 1`,
      [userId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`${userId} is not a real teacher in this tenant`);
    }
  }
}
