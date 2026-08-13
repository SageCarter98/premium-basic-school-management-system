import { IsIn, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const TYPES = ['scholarship', 'discount', 'waiver', 'sponsor_credit'];

/** request-assistance.dto.ts — FR-FIN-010: a reason is always mandatory;
 * whether a second approver is also required is computed in
 * finance.service.ts against a threshold, not supplied by the caller. */
export class RequestAssistanceDto {
  @IsUuidLike()
  studentId!: string;

  @IsUuidLike()
  invoiceId!: string;

  @IsIn(TYPES)
  type!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
