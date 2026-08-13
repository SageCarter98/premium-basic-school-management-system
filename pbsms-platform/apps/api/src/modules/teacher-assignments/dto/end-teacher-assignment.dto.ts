import { IsOptional, IsString } from 'class-validator';

/** end-teacher-assignment.dto.ts — flips a teacher_assignments row to
 * 'ended'. Never deleted, same reasoning every other historical-record
 * table in this codebase uses: a past assignment stays queryable. */
export class EndTeacherAssignmentDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
