import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class TransitionTenantDto {
  @IsString()
  toStatus!: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsBoolean()
  billingMethodConfirmed?: boolean;

  @IsOptional()
  @IsString()
  freeTierApprovalReason?: string;
}
