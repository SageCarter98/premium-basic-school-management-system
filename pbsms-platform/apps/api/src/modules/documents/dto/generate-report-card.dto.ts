import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** generate-report-card.dto.ts — FR-DOC-010: must be a specific
 * approved (published/locked/archived) student_results version, never
 * "the current result" — checked in documents.service.ts. */
export class GenerateReportCardDto {
  @IsUuidLike()
  studentResultId!: string;
}
