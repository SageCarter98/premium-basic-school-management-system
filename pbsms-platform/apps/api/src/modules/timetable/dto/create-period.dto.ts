import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min } from 'class-validator';

const TIME_SHAPE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PERIOD_TYPES = ['teaching', 'break', 'assembly', 'other'] as const;

/** create-period.dto.ts — a tenant-wide time-of-day template (e.g. "Period
 * 1, 08:00-08:40"), reused across every day_of_week a class meets at that
 * slot (see 0033_timetable.sql's header). end > start is checked by the
 * DB's own CHECK constraint, not re-validated here. `periodType` defaults
 * to 'teaching' — a tenant only needs to set it for the non-teaching slots
 * (break/assembly/other) it wants to show on its own timetable builder. */
export class CreatePeriodDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsInt()
  @Min(1)
  sequence!: number;

  @Matches(TIME_SHAPE, { message: 'startTime must be HH:MM (24-hour)' })
  startTime!: string;

  @Matches(TIME_SHAPE, { message: 'endTime must be HH:MM (24-hour)' })
  endTime!: string;

  @IsOptional()
  @IsIn(PERIOD_TYPES)
  periodType?: (typeof PERIOD_TYPES)[number];
}
