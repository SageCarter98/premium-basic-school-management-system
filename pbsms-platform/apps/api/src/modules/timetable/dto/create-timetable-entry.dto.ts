import { IsIn, IsOptional } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/** create-timetable-entry.dto.ts — one class+subject+teacher assigned to
 * one period on one day of the week, for one academic year (standing in
 * for "term" — see 0033_timetable.sql's header). roomId is optional: not
 * every period needs a dedicated room. FR-ACA-040's conflict detection
 * happens in timetable.service.ts, not here. */
export class CreateTimetableEntryDto {
  @IsUuidLike()
  academicYearId!: string;

  @IsUuidLike()
  classId!: string;

  @IsUuidLike()
  subjectId!: string;

  @IsUuidLike()
  teacherId!: string;

  @IsUuidLike()
  periodId!: string;

  @IsOptional()
  @IsUuidLike()
  roomId?: string;

  @IsIn(DAYS)
  dayOfWeek!: (typeof DAYS)[number];
}
