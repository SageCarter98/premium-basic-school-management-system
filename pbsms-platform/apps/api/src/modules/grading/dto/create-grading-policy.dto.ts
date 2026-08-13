import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

const APPLICABILITIES = ['developmental', 'numerical', 'nacca_competency'];

/** create-grading-policy.dto.ts — FR-GRA-020: applicability picks the
 * grading model (developmental for Nursery/KG, numerical for Primary/JHS,
 * or an opt-in NaCCA competency model); it is never changed after creation
 * — a different applicability is a different policy, not an edit. */
export class CreateGradingPolicyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(APPLICABILITIES)
  applicability!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
