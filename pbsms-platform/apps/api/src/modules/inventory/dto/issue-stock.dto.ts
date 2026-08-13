import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const ISSUED_TO_TYPES = ['student', 'staff'];

/** issue-stock.dto.ts — FR-OPS-050 issuance tracking. issuedToId is
 * validated against the real staff directory when issuedToType is
 * 'staff' (see inventory.service.ts's issueStock() and
 * staff.service.ts's isRealStaffMember()). The notify* fields are
 * optional recipient details for the low-stock alert, a separate id not
 * covered by that check directly — see issueStock() for why. */
export class IssueStockDto {
  @IsIn(ISSUED_TO_TYPES)
  issuedToType!: string;

  @IsUuidLike()
  issuedToId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsUuidLike()
  issuedBy!: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsUuidLike()
  notifyRecipientId?: string;

  @IsOptional()
  @IsString()
  notifyRecipientName?: string;

  @IsOptional()
  @IsString()
  notifyRecipientEmail?: string;
}
