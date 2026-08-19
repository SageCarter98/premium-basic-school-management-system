import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TransitionTenantDto } from './dto/transition-tenant.dto';
import { PlatformRoles } from '../../common/auth/platform-roles.decorator';
import { PLATFORM_ONBOARDING, PLATFORM_ALL } from '../../common/auth/platform-role-groups';
import { PlatformContextStore } from '../../common/tenant/platform-context';

/**
 * tenants.controller.ts — the first controller ever mounted under
 * /v1/platform/* (tenant.middleware.ts's PLATFORM_PATH_PREFIX). actorId
 * comes from PlatformContextStore.current().userId, resolved by the
 * middleware from a verified JWT — never a client-supplied body field,
 * which would let any caller claim to be any platform actor.
 */
@Controller('v1/platform/tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @PlatformRoles(...PLATFORM_ONBOARDING)
  @Post()
  create(@Body() body: CreateTenantDto) {
    const { userId } = PlatformContextStore.current();
    return this.tenants.create(userId, body);
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Get()
  findAll() {
    return this.tenants.findAll();
  }

  // Registered before ':id' — same "a literal segment must be matched
  // before a param route can shadow it" reasoning
  // data-protection.controller.ts's 'requests/overdue' already
  // documented. Stage 9 addition: the spec's "Platform audit log" screen
  // had no cross-tenant read at all — only the per-tenant audit-trail
  // below existed.
  @PlatformRoles(...PLATFORM_ALL)
  @Get('audit-log')
  auditLog(@Query('tenantId') tenantId?: string, @Query('action') action?: string) {
    return this.tenants.listAllAuditLog({ tenantId, action });
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenants.findOne(id);
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Post(':id/transition')
  transition(@Param('id') id: string, @Body() body: TransitionTenantDto) {
    const { userId } = PlatformContextStore.current();
    return this.tenants.transition(id, userId, body);
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Get(':id/audit-trail')
  auditTrail(@Param('id') id: string) {
    return this.tenants.listAuditTrail(id);
  }
}
