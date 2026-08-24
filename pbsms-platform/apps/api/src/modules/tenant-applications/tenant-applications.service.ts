/**
 * tenant-applications.service.ts
 *
 * Closes "Tenant can sign up via login portal if new to apply and
 * Platform-Admin should be capable to accept tenant" — see
 * 0045_tenant_applications.sql's header for the full design reasoning
 * (modeled on admissions' applicant->convert() shape, not a new tenant-
 * lifecycle state).
 *
 * Two pools, deliberately: submit() uses PG_POOL (pbsms_app — the only
 * grant that role has on this table is INSERT, for exactly this one
 * public path); every review method uses PLATFORM_POOL (pbsms_platform),
 * the same pool tenants.service.ts itself uses, since reviewing an
 * application is inherently a platform action.
 */

import { randomBytes, createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/database/tenant-database.service';
import { PLATFORM_POOL } from '../../common/database/database.module';
import { PASSWORD_HASH_OPTIONS } from '../../common/auth/password-hash';
import { TenantsService } from '../tenants/tenants.service';
import { SubmitTenantApplicationDto } from './dto/submit-tenant-application.dto';
import { ApproveTenantApplicationDto } from './dto/review-tenant-application.dto';

export interface TenantApplication {
  id: string;
  school_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  address: string | null;
  message: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  tenant_id: string | null;
  created_at: string;
}

// Same window staff.service.ts's inviteStaff() uses for the identical
// reason — long enough that a brand new school admin handling this in
// their own time doesn't feel rushed into setting a password immediately.
const SET_PASSWORD_TOKEN_MINUTES = 7 * 24 * 60;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  // A short random suffix rather than a collision-retry loop — slugs
  // aren't a user-facing critical identifier anywhere in this codebase
  // yet (no subdomain routing depends on them), so simple beats clever
  // here; two schools submitting the exact same name is the only case
  // this even matters for, and the suffix makes that a non-issue.
  return `${base || 'school'}-${randomBytes(3).toString('hex')}`;
}

@Injectable()
export class TenantApplicationsService {
  constructor(
    @Inject(PG_POOL) private readonly appPool: Pool,
    @Inject(PLATFORM_POOL) private readonly platformPool: Pool,
    private readonly tenants: TenantsService,
  ) {}

  async submit(input: SubmitTenantApplicationDto): Promise<void> {
    await this.appPool.query(
      `insert into tenant_applications (school_name, contact_name, contact_email, contact_phone, address, message)
       values ($1, $2, $3, $4, $5, $6)`,
      [input.schoolName, input.contactName, input.contactEmail, input.contactPhone ?? null, input.address ?? null, input.message ?? null],
    );
  }

  async findAll(status?: string): Promise<TenantApplication[]> {
    if (status) {
      const result = await this.platformPool.query<TenantApplication>(
        `select * from tenant_applications where status = $1 order by created_at desc`,
        [status],
      );
      return result.rows;
    }
    const result = await this.platformPool.query<TenantApplication>(
      `select * from tenant_applications order by created_at desc`,
    );
    return result.rows;
  }

  private async findOne(id: string): Promise<TenantApplication> {
    const result = await this.platformPool.query<TenantApplication>(
      `select * from tenant_applications where id = $1`,
      [id],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException(`Tenant application ${id} not found`);
    }
    return result.rows[0];
  }

  /**
   * The one method here that actually DOES something: creates the real
   * tenant (via tenants.service.ts's own create(), unchanged — reused,
   * not re-derived) and its first admin user in one flow. See
   * 0045_tenant_applications.sql's create_tenant_admin_user() for why
   * that second half needs a SECURITY DEFINER function rather than a
   * plain INSERT — pbsms_platform has no write grant on users/
   * tenant_users otherwise.
   */
  async approve(
    id: string,
    actorId: string,
    input: ApproveTenantApplicationDto,
  ): Promise<{ application: TenantApplication; tenantId: string; setPasswordToken: string; expiresAt: string }> {
    const application = await this.findOne(id);
    if (application.status !== 'pending') {
      throw new ConflictException(`Tenant application ${id} is '${application.status}', not 'pending'`);
    }

    const existing = await this.platformPool.query<{ id: string }>(
      `select id from users where lower(email) = lower($1)`,
      [application.contact_email],
    );
    if (existing.rows.length > 0) {
      throw new ConflictException(
        `A user with email ${application.contact_email} already exists — this application cannot auto-create a duplicate account`,
      );
    }

    const tenant = await this.tenants.create(actorId, {
      name: application.school_name,
      slug: slugify(application.school_name),
      billingEmail: application.contact_email,
      trialDays: input.trialDays,
    });

    const placeholderHash = await argon2.hash(randomBytes(32).toString('hex'), PASSWORD_HASH_OPTIONS);
    const rawToken = randomBytes(32).toString('hex');

    await this.platformPool.query(`select create_tenant_admin_user($1, $2, $3, $4, $5, $6, $7)`, [
      tenant.id,
      application.contact_email,
      application.contact_name,
      placeholderHash,
      input.adminRoleCode ?? 'proprietor',
      hashToken(rawToken),
      SET_PASSWORD_TOKEN_MINUTES,
    ]);

    const updated = await this.platformPool.query<TenantApplication>(
      `update tenant_applications
       set status = 'approved', reviewed_by = $1, reviewed_at = now(), tenant_id = $2, updated_at = now()
       where id = $3
       returning *`,
      [actorId, tenant.id, id],
    );

    return {
      application: updated.rows[0],
      tenantId: tenant.id,
      setPasswordToken: rawToken,
      expiresAt: new Date(Date.now() + SET_PASSWORD_TOKEN_MINUTES * 60_000).toISOString(),
    };
  }

  async reject(id: string, actorId: string, reviewNotes?: string): Promise<TenantApplication> {
    const application = await this.findOne(id);
    if (application.status !== 'pending') {
      throw new ConflictException(`Tenant application ${id} is '${application.status}', not 'pending'`);
    }
    const result = await this.platformPool.query<TenantApplication>(
      `update tenant_applications
       set status = 'rejected', reviewed_by = $1, reviewed_at = now(), review_notes = $2, updated_at = now()
       where id = $3
       returning *`,
      [actorId, reviewNotes ?? null, id],
    );
    return result.rows[0];
  }
}
