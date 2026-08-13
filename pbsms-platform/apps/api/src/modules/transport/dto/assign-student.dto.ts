import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** assign-student.dto.ts — supersedes any existing active assignment for
 * this student (see transport.service.ts's assignStudentToRoute()). */
export class AssignStudentDto {
  @IsUuidLike()
  studentId!: string;

  @IsUuidLike()
  routeId!: string;

  @IsUuidLike()
  stopId!: string;
}
