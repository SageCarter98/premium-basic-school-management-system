import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const DECISIONS = ['promoted', 'repeated', 'conditional', 'pending', 'transferred', 'completed'];

/** decide-promotion.dto.ts — FR-PRO-020: this is the human-authorized
 * decision, always a distinct action from recommend()'s system
 * recommendation, even when a caller simply accepts the recommendation
 * verbatim. toClassId/toAcademicYearId are required for
 * promoted/repeated/conditional (checked in promotion.service.ts, since
 * which fields are required depends on `decision`) and ignored otherwise —
 * transferred/completed/pending have no PBSMS-side destination class. */
export class DecidePromotionDto {
  @IsIn(DECISIONS)
  decision!: string;

  @IsOptional()
  @IsUuidLike()
  toClassId?: string;

  @IsOptional()
  @IsUuidLike()
  toAcademicYearId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  notes?: string;
}
