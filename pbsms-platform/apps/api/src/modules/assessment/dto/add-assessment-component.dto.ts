import { IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const COMPONENT_TYPES = ['class_exercise', 'homework', 'project', 'mid_term', 'end_of_term_exam'];

/** add-assessment-component.dto.ts — FR-ASM-010: component_type is one of
 * the five types 0004_assessment.sql's CHECK constraint enumerates (true
 * per-tenant custom types are a documented future enhancement, not built
 * here). maxScore defaults to 100 (the column default) when omitted.
 * `indicatorId` (Chapter 41/DOM-020, 0030_nacca_curriculum.sql) is the
 * real structured-curriculum tag; `naccaStrand` is the older free-text
 * placeholder from this same file's original pass — both stay available,
 * a tenant can use either or neither. A bad/cross-tenant `indicatorId`
 * is rejected by the composite FK at the database level, same as every
 * other id this method already accepts (structureId via the caller,
 * componentType via the CHECK) — no extra application-level lookup
 * needed here. */
export class AddAssessmentComponentDto {
  @IsIn(COMPONENT_TYPES)
  componentType!: string;

  @IsNumber()
  @Min(0.01)
  @Max(100)
  weight!: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  maxScore?: number;

  @IsOptional()
  @IsString()
  naccaStrand?: string;

  @IsOptional()
  @IsUuidLike()
  indicatorId?: string;
}
