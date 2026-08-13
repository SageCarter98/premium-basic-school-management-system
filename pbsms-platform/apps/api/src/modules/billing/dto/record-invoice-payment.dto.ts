import { IsString } from 'class-validator';

export class RecordInvoicePaymentDto {
  @IsString()
  reference!: string;
}
