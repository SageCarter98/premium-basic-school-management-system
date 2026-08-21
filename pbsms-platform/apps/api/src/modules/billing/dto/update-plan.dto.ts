import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// code is deliberately not editable here — plans stay identified by a
// stable code once created, same "don't let an identifier drift out from
// under existing references" posture as every other codebase's business
// keys (admission_no, invoice_number, etc.).
export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['flat', 'per_active_student'])
  billingBasis?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  flatFeeAmount?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  perStudentRate?: number;

  @IsOptional()
  @IsString()
  currency?: string;
}
