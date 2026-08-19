import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** create-access-grant.dto.ts — Stage 6 (Parent View). Defaults to 90
 * days (roughly a term) if omitted; capped at a year so a link can't be
 * minted effectively-forever by accident. */
export class CreateAccessGrantDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}
