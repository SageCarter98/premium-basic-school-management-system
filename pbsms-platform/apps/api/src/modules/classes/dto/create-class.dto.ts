import { IsNotEmpty, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** create-class.dto.ts — FR-API-010 server-side validation for POST /v1/classes. */
export class CreateClassDto {
  @IsUuidLike()
  academicYearId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string; // e.g. 'JHS 2A'

  @IsString()
  @IsNotEmpty()
  level!: string; // e.g. 'JHS 2'
}
