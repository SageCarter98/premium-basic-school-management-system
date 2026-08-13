import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** create-assessment-structure.dto.ts — FR-ASM-010: one structure per
 * class+subject+academic year (enforced by 0004_assessment.sql's unique
 * constraint; a duplicate insert fails closed with a Postgres error rather
 * than silently succeeding). */
export class CreateAssessmentStructureDto {
  @IsUuidLike()
  classId!: string;

  @IsUuidLike()
  subjectId!: string;

  @IsUuidLike()
  academicYearId!: string;
}
