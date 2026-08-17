import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const REQUEST_TYPES = ['access', 'rectification', 'erasure'];
const SUBJECT_TYPES = ['guardian', 'staff', 'student'];

/** create-data-subject-request.dto.ts — DP-030/DP-090. */
export class CreateDataSubjectRequestDto {
  @IsIn(REQUEST_TYPES)
  requestType!: string;

  @IsIn(SUBJECT_TYPES)
  subjectType!: string;

  @IsUuidLike()
  subjectId!: string;

  @IsString()
  @IsNotEmpty()
  requesterName!: string;

  @IsOptional()
  @IsString()
  requesterContact?: string;
}
