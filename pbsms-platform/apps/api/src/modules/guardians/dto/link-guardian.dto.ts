import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/**
 * link-guardian.dto.ts
 *
 * Creates a student_guardians row — the FR-STU-020 many-to-many link
 * itself, carrying the relationship-level flags the requirement names
 * explicitly (primary contact, emergency, pickup, finance, report
 * access). All flags default to false at the DB level (0019_guardians.sql)
 * if omitted here.
 */
export class LinkGuardianDto {
  @IsUuidLike()
  guardianId!: string;

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
