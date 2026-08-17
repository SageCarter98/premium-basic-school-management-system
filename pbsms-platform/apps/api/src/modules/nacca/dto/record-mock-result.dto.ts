import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** record-mock-result.dto.ts — DOM-050. `grade` is WAEC/BECE's real 1
 * (best) - 9 (worst) scale, not this codebase's usual percentage bands. */
export class RecordMockResultDto {
  @IsUuidLike()
  beceCandidateId!: string;

  @IsString()
  @IsNotEmpty()
  examSession!: string;

  @IsString()
  @IsNotEmpty()
  subjectName!: string;

  @IsInt()
  @Min(1)
  @Max(9)
  grade!: number;

  @IsOptional()
  @IsNumber()
  scorePercentage?: number;
}
