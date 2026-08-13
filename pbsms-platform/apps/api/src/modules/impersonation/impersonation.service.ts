/**
 * impersonation.service.ts
 *
 * Implements SRS v2.1 TEN-021/022 — Support Engineer impersonation of a
 * tenant's admin view. See 0023_impersonation.sql's header for the schema
 * design, and tenant.middleware.ts's `impersonationGrantId` branch for how
 * a minted token actually reaches an ordinary tenant-shaped route.
 *
 * The impersonation token always maps to a fixed representative
 * "admin view" role — 'administrator' (Chapter 3.2's generic admin-tier
 * role, already recognized by every ACADEMIC_ADMIN/LEADERSHIP/ALL_STAFF
 * @Roles() check in the app), never a real tenant_users row. This is a
 * deliberate simplification: Chapter 3.1 says "impersonation of a
 * tenant's admin view," singular, not "impersonation of any specific
 * tenant staff member's exact role."
 */

import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import { PLATFORM_POOL } from '../../common/database/database.module';
import { SensitiveActionType } from '../../common/auth/sensitive-action.decorator';

const MAX_GRANT_MINUTES = 120; // TEN-021 hard cap, also enforced by 0023's CHECK constraint
const IMPERSONATION_ROLE_CODES = ['administrator'];

export interface ImpersonationGrant {
  id: string;
  tenant_id: string;
  granted_to: string;
  support_ticket_ref: string;
  reason: string | null;
  granted_by: string | null;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  tenant_consent_captured: boolean;
}

export interface SensitiveApproval {
  id: string;
  grant_id: string;
  action_type: string;
  status: string;
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  consumed_at: string | null;
}

@Injectable()
export class ImpersonationService {
  constructor(
    @Inject(PLATFORM_POOL) private readonly pool: Pool,
    private readonly jwt: JwtService,
  ) {}

  async createGrant(
    actorId: string,
    input: { tenantId: string; supportTicketRef: string; reason?: string; durationMinutes?: number },
  ): Promise<ImpersonationGrant> {
    await this.assertCanImpersonate(actorId);

    const tenantRows = await this.pool.query<{ id: string }>(`select id from tenants where id = $1`, [
      input.tenantId,
    ]);
    if (tenantRows.rows.length === 0) {
      throw new NotFoundException(`Tenant ${input.tenantId} not found`);
    }
    if (!input.supportTicketRef?.trim()) {
      throw new ConflictException('A support ticket reference is required (TEN-021)');
    }

    const minutes = Math.min(input.durationMinutes ?? MAX_GRANT_MINUTES, MAX_GRANT_MINUTES);
    const result = await this.pool.query<ImpersonationGrant>(
      `insert into impersonation_grants (tenant_id, granted_to, support_ticket_ref, reason, granted_by, expires_at)
       values ($1, $2, $3, $4, $2, now() + ($5 || ' minutes')::interval)
       returning *`,
      [input.tenantId, actorId, input.supportTicketRef, input.reason ?? null, minutes],
    );
    const grant = result.rows[0];

    await this.pool.query(
      `insert into platform_audit_logs (actor_id, tenant_id, action, detail) values ($1, $2, 'impersonation_grant_created', $3)`,
      [actorId, input.tenantId, JSON.stringify({ grantId: grant.id, supportTicketRef: input.supportTicketRef, minutes })],
    );

    return grant;
  }

  async endGrant(actorId: string, grantId: string): Promise<ImpersonationGrant> {
    const result = await this.pool.query<ImpersonationGrant>(
      `update impersonation_grants set revoked_at = now(), revoked_by = $1
       where id = $2 and revoked_at is null
       returning *`,
      [actorId, grantId],
    );
    if (result.rows.length === 0) {
      throw new ConflictException(`Grant ${grantId} not found or already ended`);
    }
    const grant = result.rows[0];

    await this.pool.query(
      `insert into platform_audit_logs (actor_id, tenant_id, action, detail) values ($1, $2, 'impersonation_grant_ended', $3)`,
      [actorId, grant.tenant_id, JSON.stringify({ grantId })],
    );

    return grant;
  }

  async listGrants(filter: { tenantId?: string; grantedTo?: string }): Promise<ImpersonationGrant[]> {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.tenantId) {
      params.push(filter.tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }
    if (filter.grantedTo) {
      params.push(filter.grantedTo);
      conditions.push(`granted_to = $${params.length}`);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
    const result = await this.pool.query<ImpersonationGrant>(
      `select * from impersonation_grants ${where} order by granted_at desc`,
      params,
    );
    return result.rows;
  }

  /** Mints the short-lived JWT tenant.middleware.ts's impersonationGrantId
   * branch accepts. Only the grant's own holder may mint from it — a
   * platform_super_admin who created a grant for someone else (there is
   * no such flow currently; createGrant() always self-grants) still
   * couldn't use this to act as someone else's session. */
  async mintToken(actorId: string, grantId: string): Promise<{ accessToken: string; expiresAt: string }> {
    const rows = await this.pool.query<ImpersonationGrant>(
      `select * from impersonation_grants where id = $1 and granted_to = $2 and revoked_at is null and expires_at > now()`,
      [grantId, actorId],
    );
    if (rows.rows.length === 0) {
      throw new ForbiddenException(`Grant ${grantId} is not an active grant belonging to you`);
    }
    const grant = rows.rows[0];
    const secondsRemaining = Math.max(
      60,
      Math.floor((new Date(grant.expires_at).getTime() - Date.now()) / 1000),
    );

    const accessToken = this.jwt.sign(
      {
        sub: actorId,
        tenantId: grant.tenant_id,
        isPlatformUser: true,
        roleCodes: IMPERSONATION_ROLE_CODES,
        impersonationGrantId: grant.id,
      },
      { expiresIn: secondsRemaining },
    );

    return { accessToken, expiresAt: grant.expires_at };
  }

  async requestSensitiveApproval(
    actorId: string,
    grantId: string,
    actionType: SensitiveActionType,
  ): Promise<SensitiveApproval> {
    const rows = await this.pool.query<{ id: string }>(
      `select id from impersonation_grants where id = $1 and granted_to = $2 and revoked_at is null and expires_at > now()`,
      [grantId, actorId],
    );
    if (rows.rows.length === 0) {
      throw new ForbiddenException(`Grant ${grantId} is not an active grant belonging to you`);
    }

    const result = await this.pool.query<SensitiveApproval>(
      `insert into impersonation_sensitive_approvals (grant_id, action_type, requested_by)
       values ($1, $2, $3)
       returning *`,
      [grantId, actionType, actorId],
    );
    return result.rows[0];
  }

  /** TEN-021's four-eyes sign-off. Enforces distinctness in the service
   * (a clearer error message than letting the DB's CHECK constraint
   * reject it) — the CHECK constraint is defense in depth, not the only
   * check, same "same-row CHECK plus a service check for a better error"
   * shape as several state-machine guards elsewhere in this codebase. */
  async approveSensitiveApproval(actorId: string, approvalId: string): Promise<SensitiveApproval> {
    const rows = await this.pool.query<SensitiveApproval>(
      `select * from impersonation_sensitive_approvals where id = $1`,
      [approvalId],
    );
    if (rows.rows.length === 0) {
      throw new NotFoundException(`Sensitive approval ${approvalId} not found`);
    }
    const approval = rows.rows[0];
    if (approval.requested_by === actorId) {
      throw new ConflictException('The requester cannot also approve their own sensitive-action request (four-eyes)');
    }
    if (approval.status !== 'pending') {
      throw new ConflictException(`Sensitive approval ${approvalId} is already '${approval.status}'`);
    }

    const result = await this.pool.query<SensitiveApproval>(
      `update impersonation_sensitive_approvals set status = 'approved', approved_by = $1, approved_at = now()
       where id = $2
       returning *`,
      [actorId, approvalId],
    );
    return result.rows[0];
  }

  private async assertCanImpersonate(actorId: string): Promise<void> {
    const result = await this.pool.query<{ role_code: string }>(
      `select role_code from platform_user_roles where user_id = $1 and revoked_at is null`,
      [actorId],
    );
    const allowed = result.rows.some((r) => r.role_code === 'support_engineer' || r.role_code === 'platform_super_admin');
    if (!allowed) {
      throw new ForbiddenException(`${actorId} does not hold a platform role that permits impersonation`);
    }
  }
}
