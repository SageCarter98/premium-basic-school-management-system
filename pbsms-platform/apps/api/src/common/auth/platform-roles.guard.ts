/**
 * platform-roles.guard.ts — Chapter 3.1 role enforcement for /v1/platform/*
 * routes. Registered globally alongside RolesGuard (authorization.module.ts)
 * — same "impossible to forget" reasoning, and safe to register globally
 * because it's a no-op (returns true immediately) for the 99% of routes
 * that never carry @PlatformRoles() and never touch PlatformContextStore.
 *
 * A denial here writes to platform_audit_logs, not audit_log — this IS a
 * platform-role action (TEN-022: "all platform-role actions MUST be
 * audited"), same "a guard rejection must still be logged, Interceptors
 * never see it" lesson Authorization Pass 1 already learned for RolesGuard
 * (Nest runs Guards before Interceptors).
 */

import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Pool } from 'pg';
import { PLATFORM_ROLES_KEY } from './platform-roles.decorator';
import { PlatformContextStore } from '../tenant/platform-context';
import { PLATFORM_POOL } from '../database/database.module';

@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PLATFORM_POOL) private readonly pool: Pool,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(PLATFORM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const ctx = PlatformContextStore.current();
    const allowed = ctx.roleCodes.some((r) => requiredRoles.includes(r));
    if (!allowed) {
      const req = context.switchToHttp().getRequest<Request>();
      this.pool
        .query(
          `insert into platform_audit_logs (actor_id, tenant_id, action, detail) values ($1, null, 'reject', $2)`,
          [
            ctx.userId,
            JSON.stringify({
              method: req.method,
              path: req.originalUrl.split('?')[0],
              requiredRoles,
              actualRoles: ctx.roleCodes,
            }),
          ],
        )
        .catch(() => undefined);

      throw new ForbiddenException(
        `This action requires one of: ${requiredRoles.join(', ')}. Your platform role(s): ${ctx.roleCodes.join(', ') || '(none)'}.`,
      );
    }
    return true;
  }
}
