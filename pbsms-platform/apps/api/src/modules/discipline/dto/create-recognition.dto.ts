import { IsNotEmpty, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** create-recognition.dto.ts — FR-OPS-040 positive-behaviour recognition.
 * No workflow — a plain log, unlike discipline_cases. */
export class CreateRecognitionDto {
  @IsUuidLike()
  studentId!: string;

  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsUuidLike()
  awardedBy!: string;
}
