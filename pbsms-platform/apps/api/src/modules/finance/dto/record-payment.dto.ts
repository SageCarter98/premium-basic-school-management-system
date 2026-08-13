import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const METHODS = ['cash', 'bank_transfer', 'cheque', 'mobile_money', 'card'];

/** record-payment.dto.ts — the DB and this DTO accept all five FR-PAY-010
 * methods; finance.service.ts's recordPayment() rejects 'mobile_money'/
 * 'card' as not-yet-implemented (no real provider integration exists —
 * see 0008_finance.sql's header). Only the manual/offline methods
 * ('cash', 'bank_transfer', 'cheque') actually succeed in this pass. */
export class RecordPaymentDto {
  @IsUuidLike()
  studentId!: string;

  @IsIn(METHODS)
  method!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  providerReference?: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;
}
