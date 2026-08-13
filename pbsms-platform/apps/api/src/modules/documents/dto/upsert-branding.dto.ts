import { IsOptional, IsString } from 'class-validator';

/** upsert-branding.dto.ts — FR-DOC-030. Text-only (see
 * 0007_promotion_documents.sql's header for why logo/letterhead file
 * storage isn't built here). */
export class UpsertBrandingDto {
  @IsOptional()
  @IsString()
  schoolNameOverride?: string;

  @IsOptional()
  @IsString()
  signatoryName?: string;

  @IsOptional()
  @IsString()
  signatoryTitle?: string;
}
