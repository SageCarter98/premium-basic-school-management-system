/**
 * authorization.module.ts — wires RolesGuard and AuditLogInterceptor in
 * globally via APP_GUARD/APP_INTERCEPTOR, imported once from app.module.ts.
 * Global registration is what makes both "impossible to forget on a new
 * controller" rather than something each module remembers to apply — same
 * shape as TenantMiddleware.
 */

import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { PlatformRolesGuard } from './platform-roles.guard';
import { ImpersonationSensitiveActionGuard } from './impersonation-sensitive-action.guard';
import { AuditLogInterceptor } from '../audit/audit-log.interceptor';

@Module({
  providers: [
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PlatformRolesGuard },
    // After RolesGuard: "are you allowed to call this at all" comes
    // before "if you're impersonating, is this specific action approved".
    { provide: APP_GUARD, useClass: ImpersonationSensitiveActionGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AuthorizationModule {}
