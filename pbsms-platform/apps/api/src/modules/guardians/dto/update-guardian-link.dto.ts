import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * update-guardian-link.dto.ts
 *
 * Edits an existing student_guardians row's relationship-level flags.
 * Deliberately has no guardianId/studentId fields — changing which
 * guardian or student a link points to means deleting and recreating the
 * link, not mutating one in place.
 */
export class UpdateGuardianLinkDto {
  @IsOptional()
  @IsString()
  relationship?: string;

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
