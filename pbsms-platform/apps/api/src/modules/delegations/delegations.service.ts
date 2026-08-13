/**
 * delegations.service.ts
 *
 * Implements SRS v2.1 Chapter 13.4 ("Temporary authority includes
 * delegator, recipient, exact functions, start, end and automatic
 * expiry; delegation is visible and audited"). Enforcement lives in
 * common/auth/check-delegation.ts, read by RolesGuard — this service is
 * only the CRUD/lifecycle side (create/revoke/list).
 *
 * "You can only delegate a role you actually hold" — create() checks
 * this against tenant_users directly; a delegator can't hand off
 * authority they don't have themselves, the same "don't accept any
 * claim blindly" principle every actor-identity check in this codebase
 * already applies.
 *
 * Conflict-of-interest note (the second half of 13.4 — "prevent required
 * independent review from being silently bypassed"): verified, not
 * newly built. finance.service.ts's secondApproveAssistance() already
 * checks `assistance.first_approved_by === userId` against the real
 * actor id, not a role — a delegated APPROVE-tier role cannot bypass
 * that, since it compares who literally approved the first step,
 * regardless of whether their role came natively or via delegation. No
 * change needed there; confirmed by reading that check, not assumed.
 */

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { StaffService } from '../staff/staff.service';

export interface RoleDelegation {
  id: string;
  tenant_id: string;
  delegator_id: string;
  recipient_id: string;
  role_codes: string[];
  reason: string | null;
  starts_at: string;
  ends_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
}

@Injectable()
export class DelegationsService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly staff: StaffService,
  ) {}

  async create(input: {
    recipientId: string;
    roleCodes: string[];
    reason?: string;
    startsAt: string;
    endsAt: string;
  }): Promise<RoleDelegation> {
    const { userId } = TenantContextStore.current();

    if (!(await this.staff.isRealStaffMember(input.recipientId))) {
      throw new NotFoundException(`${input.recipientId} is not a real staff member of this tenant`);
    }

    const ownRoles = await this.db.query<{ role_code: string }>(
      `select role_code from tenant_users where user_id = $1`,
      [userId],
    );
    const ownRoleCodes = new Set(ownRoles.map((r) => r.role_code));
    const notHeld = input.roleCodes.filter((r) => !ownRoleCodes.has(r));
    if (notHeld.length > 0) {
      throw new ForbiddenException(`You cannot delegate role(s) you don't hold: ${notHeld.join(', ')}`);
    }

    const rows = await this.db.query<RoleDelegation>(
      `insert into role_delegations (tenant_id, delegator_id, recipient_id, role_codes, reason, starts_at, ends_at, created_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $1)
       returning *`,
      [userId, input.recipientId, input.roleCodes, input.reason ?? null, input.startsAt, input.endsAt],
    );
    return rows[0];
  }

  async revoke(id: string): Promise<RoleDelegation> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<RoleDelegation>(
      `update role_delegations set revoked_at = now(), revoked_by = $1
       where id = $2 and revoked_at is null and ends_at > now()
       returning *`,
      [userId, id],
    );
    if (rows.length === 0) {
      throw new ConflictException(`Delegation ${id} not found, already revoked, or already expired`);
    }
    return rows[0];
  }

  async list(filter: { recipientId?: string; delegatorId?: string }): Promise<RoleDelegation[]> {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.recipientId) {
      params.push(filter.recipientId);
      conditions.push(`recipient_id = $${params.length}`);
    }
    if (filter.delegatorId) {
      params.push(filter.delegatorId);
      conditions.push(`delegator_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
    return this.db.query<RoleDelegation>(`select * from role_delegations ${where} order by starts_at desc`, params);
  }
}
