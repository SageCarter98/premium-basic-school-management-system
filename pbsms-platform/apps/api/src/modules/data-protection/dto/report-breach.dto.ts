import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

export class ReportBreachDto {
  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUuidLike({ each: true })
  affectedTenantIds?: string[];
}
