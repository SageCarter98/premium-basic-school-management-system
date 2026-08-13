import { IsNotEmpty, IsString } from 'class-validator';

/** reopen-assessment-structure.dto.ts — FR-ASM-040: reopening published
 * data is controlled and audited; a reason is mandatory, never a silent
 * status flip. */
export class ReopenAssessmentStructureDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
