import { IsIn } from 'class-validator';

/**
 * update-applicant-status.dto.ts — FR-ADM 15.2 states. 'admitted' is
 * deliberately excluded: it is only ever reached via POST
 * /v1/admissions/:id/convert (FR-ADM-030), never a plain status edit.
 */
export class UpdateApplicantStatusDto {
  @IsIn([
    'draft',
    'submitted',
    'under_review',
    'documents_incomplete',
    'interview_scheduled',
    'waitlisted',
    'approved',
    'rejected',
    'cancelled',
  ])
  status!: string;
}
