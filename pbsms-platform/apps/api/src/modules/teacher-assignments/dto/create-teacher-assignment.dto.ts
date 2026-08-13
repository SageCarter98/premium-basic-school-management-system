import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/**
 * create-teacher-assignment.dto.ts — Chapter 17.1's "Teacher Assignments"
 * step. One row = one teacher assigned to one class+subject for one
 * academic year (see 0020_teacher_assignments.sql's header for why
 * academic_year_id stands in for "term" here). A duplicate active
 * assignment for the same slot is rejected by the DB's partial unique
 * index, not re-checked here.
 */
export class CreateTeacherAssignmentDto {
  @IsUuidLike()
  teacherId!: string;

  @IsUuidLike()
  classId!: string;

  @IsUuidLike()
  subjectId!: string;

  @IsUuidLike()
  academicYearId!: string;
}
