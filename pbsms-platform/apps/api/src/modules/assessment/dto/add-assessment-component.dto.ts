import { IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

const COMPONENT_TYPES = ['class_exercise', 'homework', 'project', 'mid_term', 'end_of_term_exam'];

/** add-assessment-component.dto.ts — FR-ASM-010: component_type is one of
 * the five types 0004_assessment.sql's CHECK constraint enumerates (true
 * per-tenant custom types are a documented future enhancement, not built
 * here). maxScore defaults to 100 (the column default) when omitted. */
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
}
