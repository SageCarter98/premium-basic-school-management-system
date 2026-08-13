/**
 * audit-log.interceptor.ts — Chapter 33.6 ("Security and business audit
 * events are append-only for ordinary users"). Registered globally (see
 * authorization.module.ts) so every mutating request is logged regardless
 * of which module handles it — a cross-cutting concern, not something each
 * module opts into, same reasoning as TenantMiddleware/RolesGuard.
 *
 * Only non-GET requests are logged. GETs aren't "business audit events" in
 * the sense Chapter 33.6 means (view/export access logging is a separate,
 * larger concern this pass doesn't attempt — see README's deferred-items
 * list) and logging every read would make audit_log the dominant write
 * load in the system for no corresponding requirement.
 *
 * Failures are logged too — a rejected/forbidden attempt is exactly the
 * kind of event Chapter 33.6's incident-response model ("detect, classify,
 * contain...") needs a record of, arguably more than a successful one.
 * status_code is exact for failures (the real thrown HttpException status)
 * and a fixed 200 for any successful completion — Nest applies the real
 * per-route status (e.g. POST's default 201) to the Express response later
 * in the pipeline than any interceptor's `tap()` can observe, so this is a
 * deliberate approximation, not an oversight.
 */

import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import type { Request } from 'express';
import { Pool } from 'pg';
import { TenantContextStore } from '../tenant/tenant-context';
import { PG_POOL } from '../database/tenant-database.service';
import { PLATFORM_POOL } from '../database/database.module';
import { writeAuditLog } from './write-audit-log';
import { writePlatformAuditLog } from './write-platform-audit-log';

const ACTION_BY_METHOD: Record<string, string> = {
  POST: 'create',
  PUT: 'edit',
  PATCH: 'edit',
  DELETE: 'archive',
};

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  // Uses PG_POOL directly, NOT TenantDatabaseService — that service is
  // Scope.REQUEST, and a singleton global enhancer (this class, registered
  // via APP_INTERCEPTOR) constructor-injecting a request-scoped provider
  // does not reliably resolve (caught live: this.db was undefined at
  // runtime, not a compile-time error — Nest's scope-propagation for
  // globally-registered enhancers doesn't behave like it does for an
  // ordinary controller-owned provider). Checking out and scoping a
  // connection by hand here — same pattern auth.module.ts's AuthService
  // already uses for the same underlying reason (it runs before any
  // per-request DI context would help anyway).
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(PLATFORM_POOL) private readonly platformPool: Pool,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.method === 'GET') return next.handle();

    const write = (statusCode: number) => {
      // Best-effort: TenantContextStore.current() throws for public,
      // no-tenant-context paths (login, health, document verify) — those
      // are exactly the requests this interceptor has nothing to log
      // against (no tenant to scope the row to), so skip them silently
      // rather than letting a logging concern break the actual request.
      let ctx;
      try {
        ctx = TenantContextStore.current();
      } catch {
        return;
      }
      const path = req.originalUrl.split('?')[0];
      const action = ACTION_BY_METHOD[req.method] ?? req.method.toLowerCase();

      writeAuditLog(this.pool, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        roles: ctx.roles,
        action,
        method: req.method,
        path,
        statusCode,
      }).catch(() => undefined); // audit logging must never break the actual request

      // TEN-022's second half: an impersonation session's actions also
      // land in platform_audit_logs, not just this tenant's own
      // audit_log above — see write-platform-audit-log.ts's header.
      if (ctx.impersonationGrantId) {
        writePlatformAuditLog(this.platformPool, {
          impersonationGrantId: ctx.impersonationGrantId,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          roles: ctx.roles,
          action,
          method: req.method,
          path,
          statusCode,
        }).catch(() => undefined);
      }
    };

    return next.handle().pipe(
      tap(() => write(200)),
      catchError((err) => {
        write(err?.status ?? 500);
        throw err;
      }),
    );
  }
}
