import { IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** create-settlement-batch.dto.ts — §8.8 Reconciliation Workspace. `source`
 * is free text (e.g. 'bank_statement', 'mtn_momo_statement') rather than a
 * fixed enum — see 0034_settlement_reconciliation.sql's header: this is a
 * manual/import record of an external statement, not a live provider
 * integration, so the set of real-world sources isn't fixed by this
 * schema. */
export class CreateSettlementBatchDto {
  @IsString()
  @IsNotEmpty()
  source!: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsISO8601()
  periodStart?: string;

  @IsOptional()
  @IsISO8601()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
