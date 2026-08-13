import { IsIn } from 'class-validator';
import { PLATFORM_ROLE_CODES } from '../platform-staff.service';

export class GrantPlatformRoleDto {
  @IsIn(PLATFORM_ROLE_CODES)
  roleCode!: (typeof PLATFORM_ROLE_CODES)[number];
}
