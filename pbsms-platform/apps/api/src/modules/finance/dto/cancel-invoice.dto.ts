import { IsNotEmpty, IsString } from 'class-validator';

/** cancel-invoice.dto.ts — records a reversal AND flips invoices.status to
 * 'cancelled' (see 0009_finance_assistance.sql's header for why that
 * status flip doesn't violate "posted transactions never edited"). */
export class CancelInvoiceDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
