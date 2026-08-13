/**
 * platform-staff.service.ts
 *
 * Implements SRS v2.1 Chapter 3.1's platform role-code system and TEN-020
 * ("Platform roles MUST NOT be assignable to any user who is also a
 * member of a tenant"). Grant/revoke, not create — the target user must
 * already exist with is_platform_user=true (same "no account-creation
 * flow yet" deferral staff.service.ts/tenants.service.ts already
 * documented for their own actor-identity checks).
 *
 * The REVERSE of TEN-020 (blocking a platform user from later being
 * added to a tenant) has no write path to protect yet — creating/
 * inviting tenant staff isn't built either. Flagged in README, not
 * silently ignored.
 */

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PLATFORM_POOL } from '../../common/database/database.module';

export const PLATFORM_ROLE_CODES = [
  'platform_super_admin',
  'support_engineer',
  'billing_administrator',
  'onboarding_specialist',
] as const;

export interface PlatformUserRole {
  id: string;
  user_id: string;
  role_code: string;
  granted_at: string;
  granted_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
}

@Injectable()
export class PlatformStaffService {
  constructor(@Inject(PLATFORM_POOL) private readonly pool: Pool) {}

  async grantRole(actorId: string, targetUserId: string, roleCode: string): Promise<PlatformUserRole> {
    const userRows = await this.pool.query<{ is_platform_user: boolean }>(
      `select is_platform_user from users where id = $1`,
      [targetUserId],
    );
    if (userRows.rows.length === 0) {
      throw new NotFoundException(`User ${targetUserId} not found`);
    }
    if (!userRows.rows[0].is_platform_user) {
      throw new ConflictException(`${targetUserId} is not flagged is_platform_user — cannot grant a platform role`);
    }

    // TEN-020: never assignable to a user who is also a member of a
    // tenant. Goes through is_tenant_member(), a SECURITY DEFINER
    // function (0022_platform_roles.sql) — NOT a direct SELECT on
    // tenant_users, which RLS would silently filter to zero rows for
    // pbsms_platform's connection (it never sets app.current_tenant),
    // making this check a no-op. See that migration's comment for how
    // this was actually caught.
    const tenantMembership = await this.pool.query<{ is_member: boolean }>(`select is_tenant_member($1) as is_member`, [
      targetUserId,
    ]);
    if (tenantMembership.rows[0].is_member) {
      throw new ConflictException(
        `${targetUserId} is a member of a tenant — platform roles cannot be assigned to a tenant member (TEN-020)`,
      );
    }

    const result = await this.pool.query<PlatformUserRole>(
      `insert into platform_user_roles (user_id, role_code, granted_by) values ($1, $2, $3) returning *`,
      [targetUserId, roleCode, actorId],
    );

    await this.pool.query(
      `insert into platform_audit_logs (actor_id, tenant_id, action, detail) values ($1, null, 'platform_role_granted', $2)`,
      [actorId, JSON.stringify({ targetUserId, roleCode })],
    );

    return result.rows[0];
  }

  async revokeRole(actorId: string, targetUserId: string, roleCode: string): Promise<PlatformUserRole> {
    const result = await this.pool.query<PlatformUserRole>(
      `update platform_user_roles set revoked_at = now(), revoked_by = $1
       where user_id = $2 and role_code = $3 and revoked_at is null
       returning *`,
      [actorId, targetUserId, roleCode],
    );
    if (result.rows.length === 0) {
      throw new ConflictException(`${targetUserId} has no active '${roleCode}' platform role grant to revoke`);
    }

    await this.pool.query(
      `insert into platform_audit_logs (actor_id, tenant_id, action, detail) values ($1, null, 'platform_role_revoked', $2)`,
      [actorId, JSON.stringify({ targetUserId, roleCode })],
    );

    return result.rows[0];
  }

  async listRoles(targetUserId: string): Promise<PlatformUserRole[]> {
    const result = await this.pool.query<PlatformUserRole>(
      `select * from platform_user_roles where user_id = $1 order by granted_at desc`,
      [targetUserId],
    );
    return result.rows;
  }
}
