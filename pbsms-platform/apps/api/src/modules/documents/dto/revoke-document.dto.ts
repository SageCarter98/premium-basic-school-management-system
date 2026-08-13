import { IsNotEmpty, IsString } from 'class-validator';

/** revoke-document.dto.ts — a reason is mandatory, never a silent
 * revocation, same reasoning as every other reason-carrying DTO in this
 * codebase (attendance corrections, assessment/grading policy reopens,
 * results returns/reopens). */
export class RevokeDocumentDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
