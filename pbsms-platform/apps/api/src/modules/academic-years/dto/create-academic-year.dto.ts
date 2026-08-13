import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** create-academic-year.dto.ts — FR-API-010 server-side validation for POST /v1/academic-years. */
export class CreateAcademicYearDto {
  @IsUuidLike()
  schoolId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string; // e.g. '2026/2027'

  @IsOptional()
  @IsIn(['planned', 'active', 'closed', 'archived'])
  status?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
