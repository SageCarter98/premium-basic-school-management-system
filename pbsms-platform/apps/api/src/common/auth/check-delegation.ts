/**
 * check-delegation.ts — Chapter 13.4's actual enforcement point, read by
 * RolesGuard when a caller's own tenant_users role_codes don't satisfy a
 * handler's @Roles() requirement. A LIVE query (not baked into the JWT at
 * login/refresh time, unlike ordinary role_codes) — a delegation's
 * start/end window needs to take effect and expire exactly on time, not
 * lag behind whenever the caller's access token happens to refresh.
 *
 * Same manually-scoped-connection pattern write-audit-log.ts already
 * uses (check out a client, SET app.current_tenant, query, release) —
 * role_delegations is an ordinary RLS'd tenant table, not a platform one,
 * so this is the standard way to run a single tenant-scoped query outside
 * TenantDatabaseService's request-scoped lifecycle.
 */

import { Pool } from 'pg';

export async function hasActiveDelegatedRole(
  pool: Pool,
  tenantId: string,
  userId: string,
  requiredRoles: string[],
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
    const result = await client.query(
      `select 1 from role_delegations
       where recipient_id = $1 and revoked_at is null and starts_at <= now() and ends_at > now()
         and role_codes && $2::text[]
       limit 1`,
      [userId, requiredRoles],
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}
