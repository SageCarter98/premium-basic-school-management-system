import { IsIn, IsISO8601, IsNotEmpty, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const SEVERITIES = ['minor', 'moderate', 'major', 'severe'];

/** create-case.dto.ts — FR-OPS-040 incident recording. */
export class CreateCaseDto {
  @IsUuidLike()
  studentId!: string;

  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsIn(SEVERITIES)
  severity!: string;

  @IsISO8601()
  incidentDate!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsUuidLike()
  reportedBy!: string;
}
