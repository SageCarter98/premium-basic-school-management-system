import { IsNumber, Min } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** allocate-payment.dto.ts — FR-PAY-050/24.1: capped in
 * finance.service.ts's allocate() at both the payment's remaining
 * unallocated amount and the invoice's remaining balance. */
export class AllocatePaymentDto {
  @IsUuidLike()
  invoiceId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;
}
