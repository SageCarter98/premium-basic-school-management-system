/**
 * write-audit-log.ts — shared by AuditLogInterceptor (all non-GET
 * outcomes reached inside the handler) and RolesGuard (403s thrown before
 * the handler is ever reached, and so before AuditLogInterceptor's
 * intercept() runs at all — Nest's pipeline is Middleware -> Guards ->
 * Interceptors -> Pipes -> Handler, so a guard rejection never gets to an
 * interceptor). Caught live: a RolesGuard 403 produced zero audit_log
 * rows until this was pulled out and called from both places — exactly
 * the kind of rejected-access-attempt event Chapter 33.6 cares about most,
 * silently missing.
 */

import { Pool } from 'pg';

export async function writeAuditLog(
  pool: Pool,
  params: {
    tenantId: string;
    userId: string;
    roles: string[];
    action: string;
    method: string;
    path: string;
    statusCode: number;
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.current_tenant', $1, false)", [params.tenantId]);
    await client.query(
      `insert into audit_log (tenant_id, actor_user_id, actor_role_codes, action, method, path, status_code)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [params.tenantId, params.userId, params.roles, params.action, params.method, params.path, params.statusCode],
    );
  } finally {
    client.release();
  }
}
