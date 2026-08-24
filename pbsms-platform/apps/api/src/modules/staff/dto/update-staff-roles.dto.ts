import { ArrayMinSize, IsArray, IsIn } from 'class-validator';
import { INVITABLE_ROLE_CODES } from './invite-staff.dto';

// Reuses invite-staff.dto.ts's own tenant-role allow-list — the same
// reasoning applies: tenant_users.role_code has no DB-level CHECK, so this
// is the application-level guard against ever writing a platform role code
// (or a typo'd one) into a tenant grant. An empty array is rejected on
// purpose — removing every role for a staff member goes through
// StaffService.deactivate() instead, which is an explicit, distinct action.
export class UpdateStaffRolesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(INVITABLE_ROLE_CODES, { each: true })
  roleCodes!: string[];
}
