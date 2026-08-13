import { IsNotEmpty, IsString } from 'class-validator';

/** reopen-result.dto.ts — FR-RES-030: "reopening requires reason and
 * authority" — the reason is mandatory here; "authority" is a Chapter 13
 * permission check, the same deferred Phase 1 item it is everywhere else
 * in this codebase. */
export class ReopenResultDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
