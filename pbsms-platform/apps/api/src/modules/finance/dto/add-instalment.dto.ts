import { IsInt, IsISO8601, IsNumber, IsOptional, Min } from 'class-validator';

/** add-instalment.dto.ts — FR-FEE-020: exactly one of `amount` or
 * `percentage` must be given (checked in finance.service.ts, since
 * class-validator can't express "exactly one of" across two optional
 * sibling fields cleanly — same reasoning as upsert-score.dto.ts).
 * `percentage` is resolved to an absolute amount at insert time; only
 * `amount` is ever stored. */
export class AddInstalmentDto {
  @IsInt()
  @Min(1)
  sequence!: number;

  @IsISO8601()
  dueDate!: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  percentage?: number;
}
