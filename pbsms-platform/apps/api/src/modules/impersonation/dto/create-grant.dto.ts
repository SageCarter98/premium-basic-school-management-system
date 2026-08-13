import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

export class CreateGrantDto {
  @IsUuidLike()
  tenantId!: string;

  @IsString()
  supportTicketRef!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  durationMinutes?: number;
}
