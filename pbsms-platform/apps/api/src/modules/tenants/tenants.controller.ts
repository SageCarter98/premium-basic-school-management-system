import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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
