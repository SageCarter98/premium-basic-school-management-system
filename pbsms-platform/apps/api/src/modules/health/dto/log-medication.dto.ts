import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** log-medication.dto.ts — FR-OPS-030 medication administration log. */
export class LogMedicationDto {
  @IsUuidLike()
  studentId!: string;

  @IsString()
  @IsNotEmpty()
  medicationName!: string;

  @IsString()
  @IsNotEmpty()
  dosage!: string;

  @IsUuidLike()
  administeredBy!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
