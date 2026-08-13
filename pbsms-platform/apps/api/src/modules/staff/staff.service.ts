/**
 * staff.service.ts — the real staff/role directory. tenant_users +
 * users already held this data (role_code has existed since 0001), but
 * nothing in the app could actually list or look up a staff member by
 * it — every module that needed to reference "a real person" (assign a
 * discipline case, contact a guardian on staff's behalf, issue stock to
 * staff) had no way to validate an id against anything real. This
 * service is that lookup.
 *
 * Read-only: creating/inviting staff (i.e. writing tenant_users rows) is
 * a separate, bigger Phase 1 platform-onboarding concern not in scope
 * here — see README's deferred-items list.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';

export interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  role_codes: string[];
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
