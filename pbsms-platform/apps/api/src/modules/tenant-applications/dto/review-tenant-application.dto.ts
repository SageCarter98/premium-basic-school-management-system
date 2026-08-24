import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

/** approve() creates the real tenant right away — trialDays lets the
 * reviewer override the default trial length the same way
 * CreateTenantDto already allows for a platform-admin-initiated tenant. */
export class ApproveTenantApplicationDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  trialDays?: number;

  // Chapter 3.2 has no single literal "school owner" role — proprietor is
  // the closest fit and the default; a reviewer who judges the applicant
  // is really an administrator/headmaster can override it.
  @IsOptional()
  @IsIn(['proprietor', 'administrator', 'headmaster'])
  adminRoleCode?: string;
}

export class RejectTenantApplicationDto {
  @IsOptional()
  @IsString()
  reviewNotes?: string;
}
