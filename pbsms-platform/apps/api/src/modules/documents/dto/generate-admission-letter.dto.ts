import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** generate-admission-letter.dto.ts — FR-DOC-010: the applicant must be
 * 'admitted' (approved data) — checked in documents.service.ts. */
export class GenerateAdmissionLetterDto {
  @IsUuidLike()
  applicantId!: string;
}
