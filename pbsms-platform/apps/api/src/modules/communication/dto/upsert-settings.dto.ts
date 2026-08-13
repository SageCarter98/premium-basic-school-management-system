import { IsNumber, IsOptional, Min } from 'class-validator';

/** upsert-settings.dto.ts — FR-COM-030: per-tenant monthly SMS cost
 * threshold + alert percentage. */
export class UpsertSettingsDto {
  @IsNumber()
  @Min(0)
  monthlySmsCostThreshold!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  alertThresholdPct?: number;
}
