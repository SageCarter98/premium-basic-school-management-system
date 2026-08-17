import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

export class CreateIndicatorDto {
  @IsUuidLike()
  subStrandId!: string;

  @IsOptional()
  @IsString()
  contentStandardCode?: string;

  @IsOptional()
  @IsString()
  contentStandardText?: string;

  @IsString()
  @IsNotEmpty()
  indicatorCode!: string;

  @IsString()
  @IsNotEmpty()
  indicatorText!: string;
}
