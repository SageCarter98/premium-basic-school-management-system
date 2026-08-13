/**
 * tenants.service.ts
 *
 * Implements SRS v2.1 Chapter 4.1 (tenant lifecycle) — the state machine,
 * TEN-023's onboarding gate, and the audited-transition requirement
 * TEN-023..026 all repeat ("every transition MUST be audited with actor,
 * reason and timestamp"). See 0021_tenant_lifecycle.sql's header for why
 * this had no connection path to its own tables until now (TEN-005:
 * `pbsms_app` has zero grants on `tenants`/`plans`/`platform_audit_logs`).
 *
 * No HTTP surface yet — see tenants.module.ts. This class takes an
 * explicit `actorId` parameter on every mutating method rather than
 * pulling one from TenantContextStore, because TenantContextStore assumes
 * a resolved TENANT context (tenantId + roles within it), which is the
 * wrong shape for a platform actor who by definition (TEN-013) belongs to
 * no tenant at all. A real platform-auth path (Phase A2) will resolve a
 * platform actor id from a JWT and pass it in here — the state-machine
 * logic itself doesn't change when that lands.
 *
 * Uses the raw PLATFORM_POOL directly (like auth.module.ts's AuthService
 * uses PG_POOL), not TenantDatabaseService — there is no per-request
 * tenant variable to set for platform tables (TEN-005 exempts them from
 * tenant_id scoping entirely), so the request-scoped wrapper would add
 * nothing but a signature TenantContextStore.current() can't satisfy here
 * anyway.
 */

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PLATFORM_POOL } from '../../common/database/database.module';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_id: string | null;
  billing_email: string | null;
  country: string;
  default_currency: string;
  default_timezone: string;
  created_at: string;
  trial_ends_at: string | null;
  suspended_at: string | null;
}

export interface PlatformAuditLogEntry {
  id: string;
  actor_id: string | null;
  tenant_id: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  country?: string;
  defaultCurrency?: string;
  defaultTimezone?: string;
  billingEmail?: string;
  trialDays?: number;
  // Optional at creation — TEN-023 only requires a plan to be set before
  // trial->onboarding, not at signup. Changing an already-assigned plan
  // (upgrade/downgrade) is Chapter 5 / a later Phase A item, not built here.
  planId?: string;
}

export interface TransitionInput {
  toStatus: string;
  reason: string;
  billingMethodConfirmed?: boolean;
  freeTierApprovalReason?: string;
}

// Chapter 4.1 lists the seven states but not a literal transition graph —
// this is a modeling decision, not a verbatim spec transcription (same
// kind of documented judgment call as Finance's role-tier split or
// Documents' polymorphic-source CHECK). 'closed' is terminal (TEN-026:
// data is permanently deleted per the retention schedule once reached) —
// every other state keeps a real way back, the same "a point-of-no-return
// state needs an explicit exit" lesson this codebase hit repeatedly
// (results.reopen(), discipline's closed->investigating path).
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  trial: ['onboarding', 'closed'],
  onboarding: ['active', 'closed'],
  active: ['past_due', 'offboarding'],
  past_due: ['active', 'suspended'],
  suspended: ['active', 'offboarding'],
  offboarding: ['closed'],
  closed: [],
};

@Injectable()
export class TenantsService {
  constructor(@Inject(PLATFORM_POOL) private readonly pool: Pool) {}

  async create(actorId: string, input: CreateTenantInput): Promise<Tenant> {
    await this.assertIsPlatformUser(actorId);

    const trialDays = input.trialDays ?? 30;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const rows = await client.query<Tenant>(
        `insert into tenants (name, slug, country, default_currency, default_timezone, billing_email, plan_id, trial_ends_at)
         values ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' days')::interval)
         returning *`,
        [
          input.name,
          input.slug,
          input.country ?? 'GH',
          input.defaultCurrency ?? 'GHS',
          input.defaultTimezone ?? 'Africa/Accra',
          input.billingEmail ?? null,
          input.planId ?? null,
          trialDays,
        ],
      );
      const tenant = rows.rows[0];
      const detail = JSON.stringify({ trialDays });
      await client.query(
        `insert into platform_audit_logs (actor_id, tenant_id, action, detail) values ($1, $2, 'tenant_created', $3)`,
        [actorId, tenant.id, detail],
      );
      // TEN-022's second half: this action also lands in the tenant's OWN
      // audit_log, not just platform_audit_logs — see this migration's
      // header for why a SECURITY DEFINER function, not a direct insert.
      const actorRoleCodes = await this.getPlatformRoleCodes(client, actorId);
      await client.query(
        `select record_platform_action_in_tenant_audit($1, $2, $3, 'tenant_created', 'PLATFORM', 'tenant.create', 200, $4)`,
        [tenant.id, actorId, actorRoleCodes, detail],
      );
      await client.query('COMMIT');
      return tenant;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async findAll(): Promise<Tenant[]> {
    const result = await this.pool.query<Tenant>(`select * from tenants order by created_at desc`);
    return result.rows;
  }

  async findOne(id: string): Promise<Tenant> {
    const result = await this.pool.query<Tenant>(`select * from tenants where id = $1`, [id]);
    if (result.rows.length === 0) {
      throw new NotFoundException(`Tenant ${id} not found`);
    }
    return result.rows[0];
  }

  async listAuditTrail(tenantId: string): Promise<PlatformAuditLogEntry[]> {
    const result = await this.pool.query<PlatformAuditLogEntry>(
      `select * from platform_audit_logs where tenant_id = $1 order by created_at desc`,
      [tenantId],
    );
    return result.rows;
  }

  /** The lifecycle state machine itself. BEGIN/FOR UPDATE/COMMIT, same
   * shape as admissions.service.ts's convert() — validates against the
   * row's current state and flips it atomically, so a concurrent
   * transition on the same tenant can't interleave with this one. */
  async transition(tenantId: string, actorId: string, input: TransitionInput): Promise<Tenant> {
    await this.assertIsPlatformUser(actorId);
    if (!input.reason?.trim()) {
      throw new ConflictException('A reason is required for every tenant status transition (TEN-023..026)');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const rows = await client.query<Tenant>(`select * from tenants where id = $1 for update`, [tenantId]);
      if (rows.rows.length === 0) {
        throw new NotFoundException(`Tenant ${tenantId} not found`);
      }
      const tenant = rows.rows[0];
      const fromStatus = tenant.status;

      const allowedNext = ALLOWED_TRANSITIONS[fromStatus] ?? [];
      if (!allowedNext.includes(input.toStatus)) {
        throw new ConflictException(
          `Cannot transition tenant from '${fromStatus}' to '${input.toStatus}'. ` +
            (allowedNext.length > 0
              ? `Valid next states: ${allowedNext.join(', ')}.`
              : `'${fromStatus}' is terminal — no further transitions are possible.`),
        );
      }

      // TEN-023: trial -> onboarding requires a plan already selected AND
      // either a confirmed billing method or a recorded free-tier approval
      // exception. The billing-method mechanism itself (Chapter 5) is a
      // separate, later Phase A item — this only enforces the gate.
      if (fromStatus === 'trial' && input.toStatus === 'onboarding') {
        if (!tenant.plan_id) {
          throw new ConflictException('Cannot move to onboarding: no plan has been selected for this tenant');
        }
        if (!input.billingMethodConfirmed && !input.freeTierApprovalReason?.trim()) {
          throw new ConflictException(
            'Cannot move to onboarding: requires billingMethodConfirmed=true or a freeTierApprovalReason (TEN-023)',
          );
        }
      }

      const nowIfSuspended = input.toStatus === 'suspended';
      const clearSuspendedAt = fromStatus === 'suspended' && input.toStatus !== 'suspended';
      const updated = await client.query<Tenant>(
        `update tenants
         set status = $1,
             suspended_at = case when $2 then now() when $3 then null else suspended_at end
         where id = $4
         returning *`,
        [input.toStatus, nowIfSuspended, clearSuspendedAt, tenantId],
      );

      const detail = JSON.stringify({
        fromStatus,
        toStatus: input.toStatus,
        reason: input.reason,
        billingMethodConfirmed: input.billingMethodConfirmed ?? null,
        freeTierApprovalReason: input.freeTierApprovalReason ?? null,
      });
      await client.query(
        `insert into platform_audit_logs (actor_id, tenant_id, action, detail) values ($1, $2, 'tenant_status_transition', $3)`,
        [actorId, tenantId, detail],
      );
      // TEN-022's second half — see create()'s identical call above.
      const actorRoleCodes = await this.getPlatformRoleCodes(client, actorId);
      await client.query(
        `select record_platform_action_in_tenant_audit($1, $2, $3, 'tenant_status_transition', 'PLATFORM', 'tenant.transition', 200, $4)`,
        [tenantId, actorId, actorRoleCodes, detail],
      );

      await client.query('COMMIT');
      return updated.rows[0];
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async assertIsPlatformUser(userId: string): Promise<void> {
    const result = await this.pool.query<{ hit: number }>(
      `select 1 as hit from users where id = $1 and is_platform_user = true limit 1`,
      [userId],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException(`${userId} is not a real platform user`);
    }
  }

  /** For record_platform_action_in_tenant_audit()'s actor_role_codes
   * column — so a tenant admin reading their own audit_log can see WHICH
   * platform role acted, not just that some platform actor did. */
  private async getPlatformRoleCodes(client: PoolClient, userId: string): Promise<string[]> {
    const result = await client.query<{ role_code: string }>(
      `select role_code from platform_user_roles where user_id = $1 and revoked_at is null`,
      [userId],
    );
    return result.rows.map((r) => r.role_code);
  }
}
