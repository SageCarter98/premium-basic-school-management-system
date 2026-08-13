import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

/**
 * tenants.module.ts
 *
 * Implements SRS Chapter 4 (tenant lifecycle). Phase A1 built
 * TenantsService with no HTTP surface (no authenticated platform-actor
 * path existed yet). Phase A2 added tenant.middleware.ts's real
 * /v1/platform/* auth path (PlatformContextStore, PlatformRolesGuard) —
 * TenantsController now sits behind that, not a bypass.
 */
@Module({
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
