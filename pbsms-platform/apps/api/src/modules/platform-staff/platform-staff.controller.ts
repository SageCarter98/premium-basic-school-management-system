import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PlatformStaffService } from './platform-staff.service';
import { GrantPlatformRoleDto } from './dto/grant-platform-role.dto';
import { PlatformRoles } from '../../common/auth/platform-roles.decorator';
import { PLATFORM_SUPER_ADMIN, PLATFORM_ALL } from '../../common/auth/platform-role-groups';
import { PlatformContextStore } from '../../common/tenant/platform-context';

/**
 * platform-staff.controller.ts — Chapter 3.1 / TEN-020. Only
 * platform_super_admin can grant/revoke ("break-glass access only");
 * reading role assignments is open to any platform role (same
 * broad-read/narrow-write split every tenant-facing module already uses).
 */
@Controller('v1/platform/staff')
export class PlatformStaffController {
  constructor(private readonly platformStaff: PlatformStaffService) {}

  @PlatformRoles(...PLATFORM_SUPER_ADMIN)
  @Post(':userId/roles')
  grantRole(@Param('userId') userId: string, @Body() body: GrantPlatformRoleDto) {
    const { userId: actorId } = PlatformContextStore.current();
    return this.platformStaff.grantRole(actorId, userId, body.roleCode);
  }

  @PlatformRoles(...PLATFORM_SUPER_ADMIN)
  @Post(':userId/roles/:roleCode/revoke')
  revokeRole(@Param('userId') userId: string, @Param('roleCode') roleCode: string) {
    const { userId: actorId } = PlatformContextStore.current();
    return this.platformStaff.revokeRole(actorId, userId, roleCode);
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Get(':userId/roles')
  listRoles(@Param('userId') userId: string) {
    return this.platformStaff.listRoles(userId);
  }
}
