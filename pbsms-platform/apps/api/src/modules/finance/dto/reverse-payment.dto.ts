import { IsNotEmpty, IsString } from 'class-validator';

/** reverse-payment.dto.ts — FR-FIN-020: the original payment row is never
 * touched; a reason is mandatory for the reversal record itself. */
export class ReversePaymentDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
