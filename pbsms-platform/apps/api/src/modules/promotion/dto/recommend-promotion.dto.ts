import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** recommend-promotion.dto.ts — FR-PRO-010: the source must be a specific
 * approved (published/locked/archived) student_results row — checked in
 * promotion.service.ts, not here, since "approved" depends on the row's
 * current status, not its shape. */
export class RecommendPromotionDto {
  @IsUuidLike()
  sourceStudentResultId!: string;
}
