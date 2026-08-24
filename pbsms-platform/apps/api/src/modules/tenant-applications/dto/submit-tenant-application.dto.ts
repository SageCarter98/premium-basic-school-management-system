import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** submit-tenant-application.dto.ts — the ONE public, unauthenticated
 * write in this module (tenant-applications.controller.ts, added to
 * tenant.middleware.ts's PUBLIC_PATHS). */
export class SubmitTenantApplicationDto {
  @IsString()
  @IsNotEmpty()
  schoolName!: string;

  @IsString()
  @IsNotEmpty()
  contactName!: string;

  @IsEmail()
  contactEmail!: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  message?: string;
}
