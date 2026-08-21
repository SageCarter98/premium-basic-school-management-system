import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, ValidateIf } from 'class-validator';

// Mirrors plans_pricing_matches_basis (0024_billing.sql): exactly one of
// flatFeeAmount/perStudentRate must be set, matching billing_basis — the
// DB constraint is the real backstop, this is just a clean 400 instead of
// a raw 500 on the same violation (createFeeStructure()'s known gap,
// deliberately not repeated here).
export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(['flat', 'per_active_student'])
  billingBasis!: string;

  @ValidateIf((o) => o.billingBasis === 'flat')
  @IsNumber()
  @IsPositive()
  flatFeeAmount?: number;

  @ValidateIf((o) => o.billingBasis === 'per_active_student')
  @IsNumber()
  @IsPositive()
  perStudentRate?: number;

  @IsOptional()
  @IsString()
  currency?: string;
}
