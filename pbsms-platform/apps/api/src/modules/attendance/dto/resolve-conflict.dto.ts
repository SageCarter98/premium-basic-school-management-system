import { IsIn } from 'class-validator';

/** resolve-conflict.dto.ts — FR-ATT-011: a reviewer picks one side; nothing
 * is ever auto-merged. */
export class ResolveConflictDto {
  @IsIn(['kept_existing', 'applied_incoming'])
  resolution!: string;
}
