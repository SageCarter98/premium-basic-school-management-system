/**
 * staff.service.ts — the real staff/role directory. tenant_users +
 * users already held this data (role_code has existed since 0001), but
 * nothing in the app could actually list or look up a staff member by
 * it — every module that needed to reference "a real person" (assign a
 * discipline case, contact a guardian on staff's behalf, issue stock to
 * staff) had no way to validate an id against anything real. This
 * service is that lookup.
 *
 * inviteStaff() closes what used to be a "read-only, invite is a
 * separate bigger concern" deferral. It reuses auth.module.ts's own
 * password_reset_tokens mechanism rather than inventing a parallel
 * "activation token" table — the new user gets an unusable random
 * password_hash and an immediately-issued reset token; the real,
 * already-working POST /v1/auth/password-reset/confirm is how they set
 * their actual password and start using the account, so no new
 * "activate account" endpoint was needed either. Same "no email
 * provider — show the link as copyable text for an admin to share
 * manually" posture as MFA enrollment and NaCCA's otpauth URI.
 */

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { PASSWORD_HASH_OPTIONS } from '../../common/auth/password-hash';

// Long enough that an admin handing this to a new hire in person, or over
// a call, doesn't create pressure to set a password immediately — a real
// "forgot my password right now" reset (auth.module.ts's
// PASSWORD_RESET_TOKEN_MINUTES = 60) is a different situation.
const INVITE_TOKEN_MINUTES = 7 * 24 * 60;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  role_codes: string[];
}

export interface StaffInviteResult {
  userId: string;
  email: string;
  roleCodes: string[];
  setPasswordToken: string;
  expiresAt: string;
}

@Injectable()
export class StaffService {
  constructor(private readonly db: TenantDatabaseService) {}

  async findAll(role?: string): Promise<StaffMember[]> {
    return this.db.query<StaffMember>(
      `with matching_users as (
         select distinct user_id from tenant_users where $1::text is null or role_code = $1
       )
       select u.id, u.full_name, u.email,
              array_agg(distinct tu.role_code order by tu.role_code) as role_codes
       from matching_users mu
       join users u on u.id = mu.user_id
       join tenant_users tu on tu.user_id = u.id
       group by u.id, u.full_name, u.email
       order by u.full_name`,
      [role ?? null],
    );
  }

  async findOne(id: string): Promise<StaffMember> {
    const rows = await this.db.query<StaffMember>(
      `select u.id, u.full_name, u.email,
              array_agg(distinct tu.role_code order by tu.role_code) as role_codes
       from tenant_users tu
       join users u on u.id = tu.user_id
       where u.id = $1
       group by u.id, u.full_name, u.email`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Staff member ${id} not found`);
    }
    return rows[0];
  }

  async inviteStaff(input: InviteStaffDto): Promise<StaffInviteResult> {
    const { userId: actorId } = TenantContextStore.current();
    const email = input.email.trim().toLowerCase();

    const existing = await this.db.query<{ id: string }>(`select id from users where lower(email) = $1`, [email]);
    if (existing.length > 0) {
      throw new ConflictException(
        `A user with email ${email} already exists — adding an existing person to this tenant isn't supported by this endpoint yet`,
      );
    }

    // An unusable placeholder — argon2-hashed random bytes nobody knows,
    // never meant to authenticate anything. The set-password token below
    // is the only real way into this account until it's used.
    const placeholderHash = await argon2.hash(randomBytes(32).toString('hex'), PASSWORD_HASH_OPTIONS);

    const userRows = await this.db.query<{ id: string }>(
      `insert into users (email, password_hash, full_name) values ($1, $2, $3) returning id`,
      [email, placeholderHash, input.fullName],
    );
    const newUserId = userRows[0].id;

    for (const roleCode of input.roleCodes) {
      await this.db.query(
        `insert into tenant_users (tenant_id, user_id, role_code, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $3)`,
        [newUserId, roleCode, actorId],
      );
    }

    const rawToken = randomBytes(32).toString('hex');
    await this.db.query(
      `insert into password_reset_tokens (user_id, token_hash, expires_at)
       values ($1, $2, now() + ($3 || ' minutes')::interval)`,
      [newUserId, hashToken(rawToken), INVITE_TOKEN_MINUTES],
    );

    return {
      userId: newUserId,
      email,
      roleCodes: input.roleCodes,
      setPasswordToken: rawToken,
      expiresAt: new Date(Date.now() + INVITE_TOKEN_MINUTES * 60_000).toISOString(),
    };
  }

  /** Replaces a staff member's entire role_code set for this tenant —
   * "edit role" from the Settings screen. Deliberately whole-set replace
   * (delete then re-insert), not a diff/patch, since role_codes has no
   * natural ordering or per-row identity a caller could reference — the
   * same "whole-set replace" shape grading-scale-items config uses. An
   * empty array is rejected by UpdateStaffRolesDto's own validator;
   * removing every role goes through deactivate() instead, a distinct,
   * more consequential action worth its own audit trail. */
  async updateRoles(id: string, roleCodes: string[]): Promise<StaffMember> {
    await this.findOne(id); // 404s if not a real staff member of this tenant
    const { userId: actorId } = TenantContextStore.current();

    await this.db.query('BEGIN');
    try {
      await this.db.query(`delete from tenant_users where user_id = $1`, [id]);
      for (const roleCode of roleCodes) {
        await this.db.query(
          `insert into tenant_users (tenant_id, user_id, role_code, created_by, updated_by)
           values (current_tenant_id(), $1, $2, $3, $3)`,
          [id, roleCode, actorId],
        );
      }
      await this.db.query('COMMIT');
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
    return this.findOne(id);
  }

  /** Revokes a staff member's access to this tenant. Deletes their
   * tenant_users grant rows (the access-control fact) rather than the
   * users row itself — every historical actor_* / created_by / updated_by
   * reference across the schema FKs to users(id) directly
   * (0018_staff_directory.sql), not tenant_users, so this can never
   * orphan an audit trail or a past record the way deleting the person
   * would. Also writes a revoked_sessions row (0038) so a LEADERSHIP-tier
   * deactivation takes effect immediately via tenant.middleware.ts's live
   * check, rather than waiting out that tier's already-issued access
   * token; other tiers still naturally lose access on their next token
   * refresh, since refresh() re-derives role_codes from tenant_users live
   * — same bounded-blast-radius posture 0038's own header documents. */
  async deactivate(id: string): Promise<void> {
    const { userId: actorId } = TenantContextStore.current();
    if (id === actorId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    await this.findOne(id); // 404s if not a real staff member of this tenant

    await this.db.query('BEGIN');
    try {
      await this.db.query(`delete from tenant_users where user_id = $1`, [id]);
      await this.db.query(
        `insert into revoked_sessions (user_id, revoked_at) values ($1, now())
         on conflict (user_id) do update set revoked_at = now()`,
        [id],
      );
      await this.db.query('COMMIT');
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  /** For other services validating a polymorphic recipientType/
   * issuedToType === 'staff' actor id against the real directory instead
   * of accepting any UUID blindly — see 0018_staff_directory.sql's
   * header for why this can't be a DB-level FK (recipientType can also
   * be 'guardian'/'student', which point at different tables entirely,
   * and Postgres has no conditional FK). Deliberately just user_id
   * membership, not a role check — callers that care about a specific
   * role should filter findAll() themselves. */
  async isRealStaffMember(id: string): Promise<boolean> {
    const rows = await this.db.query<{ hit: number }>(`select 1 as hit from tenant_users where user_id = $1 limit 1`, [
      id,
    ]);
    return rows.length > 0;
  }
}
