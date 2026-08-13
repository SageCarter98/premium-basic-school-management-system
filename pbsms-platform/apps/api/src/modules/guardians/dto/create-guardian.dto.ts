import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * create-guardian.dto.ts
 *
 * FR-API-010 (server-side validation). Field names match what
 * GuardiansService.create() already expects — see guardians.service.ts.
 */
export class CreateGuardianDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;
}
