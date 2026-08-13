/**
 * roles.guard.ts — Chapter 33.2 SEC-050 (effective access includes active
 * role). Registered globally (see authorization.module.ts) so a controller
 * that "forgets" @Roles() is unrestricted-by-default rather than the guard
 * itself being something each module has to remember to apply — same
 * "impossible to forget" shape as TenantMiddleware.
 *
 * This is a SEPARATE, additional layer to tenant-isolation RLS, not a
 * replacement for it — see tenant-context.ts's own header for why RLS
 * remains the actual security boundary for tenant scope. Role scope has no
 * equivalent database-level backstop (Postgres RLS policies here are all
 * keyed on tenant_id, not role) — this guard IS the enforcement point for
 * role checks, so a bug here is not caught by any second layer the way a
 * tenant-scoping bug would be. That asymmetry is inherent to Chapter 13's
 * model, not a shortcut taken here.
 */

import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Pool } from 'pg';
import { ROLES_KEY } from './roles.decorator';
import { TenantContextStore } from '../tenant/tenant-context';
import { PG_POOL } from '../database/tenant-database.service';
import { PLATFORM_POOL } from '../database/database.module';
import { writeAuditLog } from '../audit/write-audit-log';
import { writePlatformAuditLog } from '../audit/write-platform-audit-log';
import { hasActiveDelegatedRole } from './check-delegation';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(PLATFORM_POOL) private readonly platformPool: Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() on this handler: unrestricted by role. Public paths
    // (login, health, document verification) never reach here with a
    // resolved TenantContextStore at all, so this guard doesn't apply to
    // them regardless.
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const ctx = TenantContextStore.current();
    // Chapter 13.4: a caller's own role_codes are checked first (the
    // common case, no extra query); only if that fails do we check for
    // an active delegation covering one of the required roles — an
    // impersonation session (ctx.impersonationGrantId set) has no
    // tenant_users identity to delegate FROM/TO, so it's skipped there
    // for that case, not because delegation itself is impersonation-aware.
    const ownRoleAllowed = ctx.roles.some((r) => requiredRoles.includes(r));
    const allowed =
      ownRoleAllowed ||
      (!ctx.impersonationGrantId && (await hasActiveDelegatedRole(this.pool, ctx.tenantId, ctx.userId, requiredRoles)));
    if (!allowed) {
      // A guard rejection never reaches AuditLogInterceptor (Nest's
      // pipeline runs Guards before Interceptors) — this write is the
      // ONLY place a denied-by-role attempt gets logged. See
      // write-audit-log.ts's header for how this was actually caught.
      const req = context.switchToHttp().getRequest<Request>();
      writeAuditLog(this.pool, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        roles: ctx.roles,
        action: 'reject',
        method: req.method,
        path: req.originalUrl.split('?')[0],
        statusCode: 403,
      }).catch(() => undefined);

      // TEN-022's second half for an impersonation session's denials too
      // — see write-platform-audit-log.ts's header.
      if (ctx.impersonationGrantId) {
        writePlatformAuditLog(this.platformPool, {
          impersonationGrantId: ctx.impersonationGrantId,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          roles: ctx.roles,
          action: 'reject',
          method: req.method,
          path: req.originalUrl.split('?')[0],
          statusCode: 403,
        }).catch(() => undefined);
      }

      throw new ForbiddenException(
        `This action requires one of: ${requiredRoles.join(', ')}. Your role(s): ${ctx.roles.join(', ') || '(none)'}.`,
      );
    }
    return true;
  }
}
