import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** convert-applicant.dto.ts — FR-ADM-030: the enrolment half of conversion
 * needs a target academic year and class; the student half is derived
 * entirely from the applicant's own captured data. */
export class ConvertApplicantDto {
  @IsUuidLike()
  academicYearId!: string;

  @IsUuidLike()
  classId!: string;
}
