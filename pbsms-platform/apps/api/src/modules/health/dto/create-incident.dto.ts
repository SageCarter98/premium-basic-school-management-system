import { IsIn, IsISO8601, IsNotEmpty, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const SEVERITIES = ['minor', 'moderate', 'major', 'severe'];

/** create-incident.dto.ts — FR-OPS-030 incident logging. */
export class CreateIncidentDto {
  @IsUuidLike()
  studentId!: string;

  @IsISO8601()
  incidentDate!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsIn(SEVERITIES)
  severity!: string;
}
