/**
 * tenant-context.ts
 *
 * Implements SRS v2.1 TEN-003/TEN-004: every request MUST resolve exactly
 * one tenant before any handler executes, and that tenant MUST be set on
 * the database session before any query runs.
 *
 * We use Node's AsyncLocalStorage so that the resolved tenant is available
 * anywhere in the async call chain of a single request — controllers,
 * services, repositories — without having to thread a `tenantId` parameter
 * through every function signature by hand (which is exactly the kind of
 * "one missing parameter" mistake Chapter 1.3 designed RLS to survive).
 *
 * IMPORTANT: this in-process context is a convenience for building queries.
 * It is NOT the security boundary. The security boundary is the PostgreSQL
 * Row-Level Security policy in infra/migrations/0001_init_tenancy.sql. If
 * this file has a bug, RLS is what stops a cross-tenant read from actually
 * returning data — see database.module.ts for where that guarantee is wired
 * in at the connection level, not just here.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
  /** True for a genuine impersonation session (Phase A3, TEN-021) — the
   * only way TenantContextStore ever carries isPlatformUser: true. An
   * ordinary platform-role request (no impersonation) never reaches
   * TenantContextStore at all; see platform-context.ts/tenant.middleware.ts. */
  isPlatformUser: boolean;
  userId: string;
  /** Chapter 13.2 role_code(s) this user holds in this tenant — read by
   * RolesGuard (common/auth/roles.guard.ts). A user can hold more than one
   * (tenant_users' own unique constraint is tenant+user+role_code). For an
   * impersonation session this is the fixed representative admin-view role
   * tenant.middleware.ts maps every impersonation token to, not a real
   * tenant_users row. */
  roles: string[];
  /** Set only for an impersonation session — the impersonation_grants.id
   * this request is running under (Phase A3, TEN-021/022). Read by
   * AuditLogInterceptor (dual-logs to platform_audit_logs too) and
   * ImpersonationSensitiveActionGuard (TEN-021's four-eyes gate). */
  impersonationGrantId?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export const TenantContextStore = {
  run<T>(ctx: TenantContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },

  /**
   * Throws rather than returning undefined. A handler that reaches this
   * point with no tenant context resolved is exactly the bug TEN-003
   * exists to prevent — fail loudly here, in application code, in addition
   * to (never instead of) the database-level RLS backstop.
   */
  current(): TenantContext {
    const ctx = storage.getStore();
    if (!ctx) {
      throw new Error(
        'No tenant context resolved for this request. This should be ' +
          'impossible if TenantMiddleware is wired correctly on every route — ' +
          'see tenant.middleware.ts. Refusing to proceed rather than risk a ' +
          'query running with no tenant scope.',
      );
    }
    return ctx;
  },
};
