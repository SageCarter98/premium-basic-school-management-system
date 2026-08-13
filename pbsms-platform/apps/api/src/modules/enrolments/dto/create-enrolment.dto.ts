import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** create-enrolment.dto.ts — FR-API-010 server-side validation for POST /v1/enrolments. */
export class CreateEnrolmentDto {
  @IsUuidLike()
  studentId!: string;

  @IsUuidLike()
  academicYearId!: string;

  @IsUuidLike()
  classId!: string;
}
