import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const STATUSES = ['present', 'absent', 'late', 'excused', 'sick', 'suspended', 'official_activity'];

/**
 * sync-attendance.dto.ts
 *
 * FR-ATT-010: this is the ONE endpoint both a normal connected teacher
 * screen and a future offline queue (Chapter 34.3) call — the "normal"
 * case is just a one-entry array. deviceTimestamp is optional because a
 * directly-connected client has no meaningful device/server clock skew to
 * record; the service defaults it to server-receipt time when absent (see
 * attendance.service.ts).
 */
export class SyncAttendanceEntryDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsUuidLike()
  studentId!: string;

  @IsUuidLike()
  classId!: string;

  @IsDateString()
  attendanceDate!: string;

  @IsOptional()
  @IsString()
  session?: string;

  @IsIn(STATUSES)
  status!: string;

  @IsOptional()
  @IsDateString()
  deviceTimestamp?: string;
}

export class SyncAttendanceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SyncAttendanceEntryDto)
  entries!: SyncAttendanceEntryDto[];
}
