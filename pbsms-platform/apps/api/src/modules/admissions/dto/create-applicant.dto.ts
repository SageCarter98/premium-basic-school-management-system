import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** create-applicant.dto.ts — FR-API-010 server-side validation for POST /v1/admissions. */
export class CreateApplicantDto {
  @IsUuidLike()
  schoolId!: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  previousSchool?: string;
}
