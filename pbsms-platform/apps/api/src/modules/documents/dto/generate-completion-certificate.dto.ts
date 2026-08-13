import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** generate-completion-certificate.dto.ts — FR-DOC-010: the promotion
 * decision must be 'completed' AND already 'applied' — checked in
 * documents.service.ts. */
export class GenerateCompletionCertificateDto {
  @IsUuidLike()
  promotionDecisionId!: string;
}
