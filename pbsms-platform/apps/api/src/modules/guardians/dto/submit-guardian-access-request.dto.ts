import { IsEmail, IsOptional, IsString, IsNotEmpty } from 'class-validator';

/** submit-guardian-access-request.dto.ts — the ONE public, unauthenticated
 * write in this module (guardians.controller.ts, added to tenant.
 * middleware.ts's PUBLIC_PATHS). See 0043_guardian_access_requests.sql's
 * header for why schoolCode+admissionNo (not a tenant id) is how this
 * resolves which school a request is for. */
export class SubmitGuardianAccessRequestDto {
  @IsString()
  @IsNotEmpty()
  schoolCode!: string;

  @IsString()
  @IsNotEmpty()
  admissionNo!: string;

  @IsString()
  @IsNotEmpty()
  requesterName!: string;

  @IsOptional()
  @IsString()
  requesterPhone?: string;

  @IsOptional()
  @IsEmail()
  requesterEmail?: string;

  @IsOptional()
  @IsString()
  relationship?: string;

  @IsOptional()
  @IsString()
  message?: string;
}
