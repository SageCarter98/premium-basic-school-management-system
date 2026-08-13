import { IsISO8601 } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** issue-loan.dto.ts — FR-OPS-010 circulation: issue. */
export class IssueLoanDto {
  @IsUuidLike()
  itemId!: string;

  @IsUuidLike()
  memberId!: string;

  @IsISO8601()
  dueDate!: string;
}
