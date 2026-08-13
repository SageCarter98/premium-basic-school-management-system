import { IsNotEmpty, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** create-fee-structure.dto.ts — FR-FEE-010, simplified to (academicYear,
 * level) scoping — see 0008_finance.sql's header for why `level` is a
 * free-text match against classes.level rather than a classId. */
export class CreateFeeStructureDto {
  @IsUuidLike()
  academicYearId!: string;

  @IsString()
  @IsNotEmpty()
  level!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;
}
