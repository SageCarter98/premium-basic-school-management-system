import { IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** create-penalty-rule.dto.ts — FR-FEE-040. `triggerType` is not exposed
 * here: 'invoice_overdue' is the only trigger this schema can evaluate
 * (see 0032_fee_penalty.sql's header), so the service sets it directly
 * rather than accepting a field with exactly one valid value. */
export class CreatePenaltyRuleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  gracePeriodDays?: number;

  @IsIn(['fixed', 'percentage'])
  amountType!: 'fixed' | 'percentage';

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  capAmount?: number;

  @IsIn(['one_time', 'daily', 'weekly', 'monthly'])
  frequency!: 'one_time' | 'daily' | 'weekly' | 'monthly';
}
