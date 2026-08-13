import { ArrayMinSize, IsArray, IsISO8601, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

export class CreateDelegationDto {
  @IsUuidLike()
  recipientId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roleCodes!: string[];

  @IsOptional()
  @IsString()
  reason?: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;
}
