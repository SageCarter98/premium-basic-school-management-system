/**
 * impersonation-sensitive-action.guard.ts — TEN-021's four-eyes gate:
 * "[impersonation] MUST NOT permit financial reversal, data export, or
 * permission changes without a second platform approver." Registered
 * globally alongside RolesGuard/PlatformRolesGuard (same no-op-when-absent
 * safety shape) — a no-op for any handler without @SensitiveAction() and
 * a no-op for any request that isn't a genuine impersonation session
 * (ctx.impersonationGrantId unset), so a real tenant admin performing a
 * reversal is completely unaffected.
 *
 * A matching approval is single-use: the UPDATE below only succeeds once
 * per approved row (consumed_at IS NULL in the WHERE clause), so the same
 * four-eyes sign-off can't silently cover two separate reversals.
 */

import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Pool } from 'pg';
import { SENSITIVE_ACTION_KEY, SensitiveActionType } from './sensitive-action.decorator';
import { TenantContextStore } from '../tenant/tenant-context';
import { PLATFORM_POOL } from '../database/database.module';

@Injectable()
export class ImpersonationSensitiveActionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PLATFORM_POOL) private readonly platformPool: Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const actionType = this.reflector.getAllAndOverride<SensitiveActionType | undefined>(SENSITIVE_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!actionType) return true;

    const ctx = TenantContextStore.current();
    if (!ctx.impersonationGrantId) return true; // not an impersonation session — TEN-021 doesn't apply

    const result = await this.platformPool.query<{ id: string }>(
      `update impersonation_sensitive_approvals
       set consumed_at = now()
       where grant_id = $1 and action_type = $2 and status = 'approved' and consumed_at is null
       returning id`,
      [ctx.impersonationGrantId, actionType],
    );
    if (result.rows.length === 0) {
      throw new ForbiddenException(
        `TEN-021: '${actionType}' requires a second platform approver's sign-off before an impersonation ` +
          `session may perform it — request one via POST /v1/platform/impersonation/${ctx.impersonationGrantId}/sensitive-approvals`,
      );
    }
    return true;
  }
}
