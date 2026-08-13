import { IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** upsert-record.dto.ts — one restricted health record per student
 * (health.service.ts's upsertRecord() creates or updates it). */
export class UpsertRecordDto {
  @IsUuidLike()
  studentId!: string;

  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @IsOptional()
  @IsString()
  allergies?: string;

  @IsOptional()
  @IsString()
  conditions?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
