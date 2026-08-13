/**
 * write-platform-audit-log.ts — TEN-022's second half for an
 * impersonation session ("all platform-role actions against a tenant
 * MUST be written to both the platform audit log and that tenant's own
 * audit log"). writeAuditLog() (write-audit-log.ts) already covers the
 * tenant's own audit_log for any request that resolves TenantContextStore
 * — which an impersonation session does (tenant.middleware.ts). This is
 * the platform_audit_logs half, called alongside it wherever
 * writeAuditLog() is, but ONLY when the context is actually an
 * impersonation session (ctx.impersonationGrantId set) — an ordinary
 * tenant user's actions never touch platform_audit_logs.
 */

import { Pool } from 'pg';

export async function writePlatformAuditLog(
  pool: Pool,
  params: {
    impersonationGrantId: string;
    tenantId: string;
    userId: string;
    roles: string[];
    action: string;
    method: string;
    path: string;
    statusCode: number;
  },
): Promise<void> {
  await pool.query(
    `insert into platform_audit_logs (actor_id, tenant_id, action, detail) values ($1, $2, $3, $4)`,
    [
      params.userId,
      params.tenantId,
      params.action,
      JSON.stringify({
        impersonationGrantId: params.impersonationGrantId,
        roles: params.roles,
        method: params.method,
        path: params.path,
        statusCode: params.statusCode,
      }),
    ],
  );
}
