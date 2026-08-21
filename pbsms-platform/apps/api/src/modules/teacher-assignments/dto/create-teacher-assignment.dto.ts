import { IsBoolean, IsOptional } from 'class-validator';
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

  // Chapter 21.1's "Class Teacher" — optional, defaults false. At most one
  // ACTIVE class teacher per class+year is enforced by the DB's own
  // partial unique index (0039_class_teacher.sql), independent of the
  // per-subject uq_teacher_assignments_active_slot rule.
  @IsOptional()
  @IsBoolean()
  isClassTeacher?: boolean;
}
