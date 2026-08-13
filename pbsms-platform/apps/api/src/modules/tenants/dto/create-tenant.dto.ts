import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

export class CreateTenantDto {
  @IsString()
  name!: string;

  @IsString()
  slug!: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  @IsOptional()
  @IsString()
  defaultTimezone?: string;

  @IsOptional()
  @IsString()
  billingEmail?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  trialDays?: number;

  @IsOptional()
  @IsUuidLike()
  planId?: string;
}
