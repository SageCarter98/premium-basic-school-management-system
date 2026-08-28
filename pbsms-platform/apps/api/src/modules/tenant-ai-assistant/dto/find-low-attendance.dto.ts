import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/**
 * Chapter 47 stage 1 (§47.0.2): the retrieval layer's input shape for the
 * §47.3.1 worked example (attendance below a threshold). Deliberately
 * fully structured — no free-text `question` field anywhere — so this
 * increment needs no AI model provider (§47.18's open model-provider/
 * DP-103/DP-107 questions stay untouched by building this).
 */
export class FindLowAttendanceDto {
  @IsInt()
  @Min(0)
  @Max(100)
  thresholdPercentage!: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsUuidLike()
  classId?: string;
}
