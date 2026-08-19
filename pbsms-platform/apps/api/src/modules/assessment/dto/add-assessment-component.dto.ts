import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

// The 5 built-ins every tenant gets for free, recognized in
// assessment.service.ts's addComponent() alongside whatever a tenant has
// additionally defined in assessment_component_types
// (0036_assessment_component_types.sql). Exported so the service doesn't
// hand-duplicate this list.
export const BUILT_IN_COMPONENT_TYPES = ['class_exercise', 'homework', 'project', 'mid_term', 'end_of_term_exam'];

/** add-assessment-component.dto.ts — FR-ASM-010: componentType used to be
 * a fixed 5-value CHECK constraint (0004_assessment.sql); per-tenant
 * custom types (0036_assessment_component_types.sql) can't be a
 * compile-time @IsIn(), so this only validates shape here — addComponent()
 * validates the actual value against BUILT_IN_COMPONENT_TYPES OR the
 * tenant's own assessment_component_types rows. maxScore defaults to 100
 * (the column default) when omitted. `indicatorId` (Chapter 41/DOM-020,
 * 0030_nacca_curriculum.sql) is the real structured-curriculum tag;
 * `naccaStrand` is the older free-text placeholder from this same file's
 * original pass — both stay available, a tenant can use either or
 * neither. A bad/cross-tenant `indicatorId` is rejected by the composite
 * FK at the database level. */
export class AddAssessmentComponentDto {
  @IsString()
  @IsNotEmpty()
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
