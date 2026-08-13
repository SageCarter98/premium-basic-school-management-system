import { IsIn, IsNotEmpty, IsString } from 'class-validator';

const STATUSES = ['present', 'absent', 'late', 'excused', 'sick', 'suspended', 'official_activity'];

/** correct-attendance.dto.ts — FR-ATT-030: a reason is mandatory; permission
 * enforcement for "after the submission window" is a Phase 1 build item
 * (Chapter 13), same deferral as every other module in this codebase. */
export class CorrectAttendanceDto {
  @IsIn(STATUSES)
  status!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
