import { IsISO8601, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** add-settlement-line.dto.ts — one external transaction line within a
 * settlement batch. `lineReference` is matched against
 * payments.provider_reference by autoMatch() — see finance.service.ts's
 * Settlement Reconciliation section header. */
export class AddSettlementLineDto {
  @IsOptional()
  @IsString()
  lineReference?: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsISO8601()
  valueDate?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
