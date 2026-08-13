import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** create-school.dto.ts — FR-API-010 server-side validation for POST /v1/schools. */
export class CreateSchoolDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsOptional()
  @IsIn(['nursery_to_jhs'])
  levelScope?: string;

  @IsOptional()
  @IsString()
  address?: string;
}
