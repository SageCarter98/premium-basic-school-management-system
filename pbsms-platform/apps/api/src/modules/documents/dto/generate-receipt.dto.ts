import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** generate-receipt.dto.ts — the payment must exist; unlike the other
 * generate*() DTOs there's no status gate here since this pass's manual
 * payments go straight to 'recorded' with no intermediate unverified
 * state (see 0008_finance.sql's header). */
export class GenerateReceiptDto {
  @IsUuidLike()
  paymentId!: string;
}
