import { IsNotEmpty, IsString } from 'class-validator';

/** return-result.dto.ts — FR-RES-010: a submitted/reviewed result sent
 * back for correction always carries a reason, never a silent bounce. */
export class ReturnResultDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
