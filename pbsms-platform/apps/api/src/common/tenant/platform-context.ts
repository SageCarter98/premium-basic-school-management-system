/**
 * platform-context.ts
 *
 * The platform-actor equivalent of tenant-context.ts's TenantContextStore
 * — deliberately a SEPARATE store, not a variant of TenantContext, because
 * a platform actor (TEN-013: belongs to no tenant) doesn't have the shape
 * TenantContext assumes (a resolved tenantId). tenant.middleware.ts
 * resolves this instead of TenantContextStore for requests under
 * /v1/platform/* from a real isPlatformUser JWT (see that file for the
 * path-prefix gate). TenantDatabaseService/RLS-backed queries are
 * meaningless here — platform tables (tenants/plans/platform_audit_logs/
 * platform_user_roles) aren't tenant-scoped at all (TEN-005) — so
 * platform-facing services use PLATFORM_POOL directly instead.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface PlatformContext {
  userId: string;
  /** Chapter 3.1 platform role codes (platform_user_roles.role_code) —
   * NOT tenant role_codes, which a platform user never has (no
   * tenant_users row per TEN-013). Read by PlatformRolesGuard. */
  roleCodes: string[];
}

const storage = new AsyncLocalStorage<PlatformContext>();

export const PlatformContextStore = {
  run<T>(ctx: PlatformContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },

  current(): PlatformContext {
    const ctx = storage.getStore();
    if (!ctx) {
      throw new Error(
        'No platform context resolved for this request. This should be impossible for any ' +
          'route under /v1/platform/* if tenant.middleware.ts is wired correctly — refusing to ' +
          'proceed rather than let a platform-facing handler run with no actor identity.',
      );
    }
    return ctx;
  },
};
