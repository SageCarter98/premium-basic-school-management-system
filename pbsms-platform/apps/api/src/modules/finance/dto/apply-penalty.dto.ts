import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** apply-penalty.dto.ts — always an explicit staff action, never automatic
 * (see 0032_fee_penalty.sql's header). */
export class ApplyPenaltyDto {
  @IsUuidLike()
  penaltyRuleId!: string;
}
