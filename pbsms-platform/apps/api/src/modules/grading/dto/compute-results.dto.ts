import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** compute-results.dto.ts — FR-GRA-010: the engine interprets already-
 * approved (published) assessment data against an explicitly named
 * policy; it never picks "the current policy" implicitly (see
 * grading.service.ts's header comment for why that's a deliberate
 * choice, not an oversight). */
export class ComputeResultsDto {
  @IsUuidLike()
  gradingPolicyId!: string;
}
