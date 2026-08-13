import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** generate-transcript.dto.ts — spans every approved result the student
 * currently has across academic years, not one version (see
 * documents.service.ts's generateTranscript()). */
export class GenerateTranscriptDto {
  @IsUuidLike()
  studentId!: string;
}
