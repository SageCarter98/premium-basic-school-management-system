import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** create-student-result.dto.ts — FR-RES-010: the initial 'draft' version
 * (version 1) of a student's compiled result for one class+academic year.
 * Rejected by 0006_results.sql's partial unique index if a non-superseded
 * version already exists — use reopen() on the existing one instead. */
export class CreateStudentResultDto {
  @IsUuidLike()
  studentId!: string;

  @IsUuidLike()
  classId!: string;

  @IsUuidLike()
  academicYearId!: string;
}
