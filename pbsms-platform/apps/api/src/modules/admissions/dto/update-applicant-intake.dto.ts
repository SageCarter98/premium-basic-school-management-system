import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * update-applicant-intake.dto.ts — closes the FR-ADM-010 field gap
 * (0042_admissions_intake.sql's header). Separate from
 * CreateApplicantDto/create() on purpose: a real intake is progressive —
 * identity is captured first (create()), everything here typically
 * arrives over several follow-up conversations/document drop-offs, not
 * atomically at the moment the applicant record is opened. Every field is
 * optional so a PATCH can update just one thing (e.g. only the
 * documents_checklist after a parent drops off a birth certificate)
 * without a caller needing to resend the whole record.
 */
export class DocumentChecklistItemDto {
  @IsString()
  name!: string;

  @IsBoolean()
  received!: boolean;
}

export class UpdateApplicantIntakeDto {
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  homeLanguage?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  guardianName?: string;

  @IsOptional()
  @IsString()
  guardianPhone?: string;

  @IsOptional()
  @IsString()
  guardianEmail?: string;

  @IsOptional()
  @IsString()
  guardianRelationship?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  medicalNotes?: string;

  @IsOptional()
  @IsString()
  learningSupportNotes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocumentChecklistItemDto)
  documentsChecklist?: DocumentChecklistItemDto[];

  @IsOptional()
  @IsDateString()
  interviewDate?: string;

  @IsOptional()
  @IsString()
  interviewNotes?: string;

  @IsOptional()
  @IsString()
  assessmentNotes?: string;
}
