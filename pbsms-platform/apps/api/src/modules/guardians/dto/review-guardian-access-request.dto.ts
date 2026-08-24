import { IsBoolean, IsOptional, IsString } from 'class-validator';

/** approveAccessRequest() — the flags mirror linkToStudent()'s own, since
 * approval creates exactly that link; staff can still adjust them
 * afterward from the Guardians tab like any other link. */
export class ApproveGuardianAccessRequestDto {
  @IsOptional()
  @IsBoolean()
  isPrimaryContact?: boolean;

  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;

  @IsOptional()
  @IsBoolean()
  canPickup?: boolean;

  @IsOptional()
  @IsBoolean()
  hasFinanceAccess?: boolean;

  @IsOptional()
  @IsBoolean()
  hasReportAccess?: boolean;
}

export class RejectGuardianAccessRequestDto {
  @IsOptional()
  @IsString()
  reviewNotes?: string;
}
