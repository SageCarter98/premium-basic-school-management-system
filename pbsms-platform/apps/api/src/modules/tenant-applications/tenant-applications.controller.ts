import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TenantApplicationsService } from './tenant-applications.service';
import { SubmitTenantApplicationDto } from './dto/submit-tenant-application.dto';
import { ApproveTenantApplicationDto, RejectTenantApplicationDto } from './dto/review-tenant-application.dto';
import { PlatformRoles } from '../../common/auth/platform-roles.decorator';
import { PLATFORM_ONBOARDING } from '../../common/auth/platform-role-groups';
import { PlatformContextStore } from '../../common/tenant/platform-context';

/**
 * tenant-applications.controller.ts — submit() is the ONE public,
 * unauthenticated route (see tenant.middleware.ts's PUBLIC_PATHS and
 * 0045_tenant_applications.sql's header), deliberately carries no
 * decorator for that reason. Review uses PLATFORM_ONBOARDING — the same
 * tier tenants.controller.ts's own create() already requires ("set up
 * new tenants" is Chapter 3.1's literal Onboarding Specialist purpose).
 */
@Controller('v1')
export class TenantApplicationsController {
  constructor(private readonly applications: TenantApplicationsService) {}

  @Post('tenant-applications/submit')
  submit(@Body() body: SubmitTenantApplicationDto) {
    return this.applications.submit(body);
  }

  @PlatformRoles(...PLATFORM_ONBOARDING)
  @Get('platform/tenant-applications')
  findAll(@Query('status') status?: string) {
    return this.applications.findAll(status);
  }

  @PlatformRoles(...PLATFORM_ONBOARDING)
  @Post('platform/tenant-applications/:id/approve')
  approve(@Param('id') id: string, @Body() body: ApproveTenantApplicationDto) {
    const { userId } = PlatformContextStore.current();
    return this.applications.approve(id, userId, body);
  }

  @PlatformRoles(...PLATFORM_ONBOARDING)
  @Post('platform/tenant-applications/:id/reject')
  reject(@Param('id') id: string, @Body() body: RejectTenantApplicationDto) {
    const { userId } = PlatformContextStore.current();
    return this.applications.reject(id, userId, body.reviewNotes);
  }
}
