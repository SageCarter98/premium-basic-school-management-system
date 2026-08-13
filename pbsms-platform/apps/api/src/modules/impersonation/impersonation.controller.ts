import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ImpersonationService } from './impersonation.service';
import { CreateGrantDto } from './dto/create-grant.dto';
import { RequestSensitiveApprovalDto } from './dto/request-sensitive-approval.dto';
import { PlatformRoles } from '../../common/auth/platform-roles.decorator';
import { PLATFORM_SUPER_ADMIN, PLATFORM_ALL } from '../../common/auth/platform-role-groups';
import { PlatformContextStore } from '../../common/tenant/platform-context';

/**
 * impersonation.controller.ts — TEN-021/022. Everything here is called
 * with the platform actor's OWN token (not the impersonation token it
 * produces — tenant.middleware.ts refuses an impersonation token on any
 * /v1/platform/* path). Support Engineer is the named role in TEN-021;
 * platform_super_admin can also create/manage grants (break-glass,
 * Chapter 3.1) but is deliberately the ONLY role that may approve a
 * sensitive-action request — a second Support Engineer approving another
 * Support Engineer's own reversal request would not be genuine four-eyes
 * oversight.
 */
@Controller('v1/platform/impersonation')
export class ImpersonationController {
  constructor(private readonly impersonation: ImpersonationService) {}

  @PlatformRoles('support_engineer', 'platform_super_admin')
  @Post()
  createGrant(@Body() body: CreateGrantDto) {
    const { userId } = PlatformContextStore.current();
    return this.impersonation.createGrant(userId, body);
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Post(':grantId/end')
  endGrant(@Param('grantId') grantId: string) {
    const { userId } = PlatformContextStore.current();
    return this.impersonation.endGrant(userId, grantId);
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Get()
  listGrants(@Query('tenantId') tenantId?: string, @Query('grantedTo') grantedTo?: string) {
    return this.impersonation.listGrants({ tenantId, grantedTo });
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Post(':grantId/token')
  mintToken(@Param('grantId') grantId: string) {
    const { userId } = PlatformContextStore.current();
    return this.impersonation.mintToken(userId, grantId);
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Post(':grantId/sensitive-approvals')
  requestSensitiveApproval(@Param('grantId') grantId: string, @Body() body: RequestSensitiveApprovalDto) {
    const { userId } = PlatformContextStore.current();
    return this.impersonation.requestSensitiveApproval(userId, grantId, body.actionType);
  }

  @PlatformRoles(...PLATFORM_SUPER_ADMIN)
  @Post('sensitive-approvals/:approvalId/approve')
  approveSensitiveApproval(@Param('approvalId') approvalId: string) {
    const { userId } = PlatformContextStore.current();
    return this.impersonation.approveSensitiveApproval(userId, approvalId);
  }
}
