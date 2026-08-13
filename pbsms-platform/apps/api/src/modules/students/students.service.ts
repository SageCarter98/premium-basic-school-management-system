/**
 * students.service.ts
 *
 * Reference implementation of SRS v2.1 Chapter 31 (students table) and the
 * data-access pattern every other tenant-scoped module should copy.
 *
 * Notice what this file does NOT do: it never writes `WHERE tenant_id = ?`
 * anywhere. That is deliberate. Tenant scoping is enforced two layers below
 * this one — TenantDatabaseService sets the RLS session variable, and
 * PostgreSQL's row-level security policy (0001_init_tenancy.sql) does the
 * actual filtering. This service could be sloppy and forget a WHERE clause
 * entirely and it would still be tenant-safe, because the database will
 * silently return zero rows for anything outside the caller's tenant rather
 * than erroring OR leaking. That is the whole point of Chapter 1's decision
 * — see the isolation e2e test in test/tenant-isolation.e2e-spec.ts for
 * proof of this property, not just an assertion of it.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';

export interface Student {
  id: string;
  tenant_id: string;
  school_id: string;
  admission_no: string;
  first_name: string;
  last_name: string;
  status: string;
}

@Injectable()
export class StudentsService {
  constructor(private readonly db: TenantDatabaseService) {}

  async findAll(): Promise<Student[]> {
    // No tenant_id in this query. RLS supplies it. This is intentional —
    // see the file header above before "fixing" this by adding one back.
    return this.db.query<Student>(
      `select id, tenant_id, school_id, admission_no, first_name, last_name, status
       from students
       where deleted_at is null
       order by last_name, first_name`,
    );
  }

  async findOne(id: string): Promise<Student> {
    const rows = await this.db.query<Student>(
      `select * from students where id = $1 and deleted_at is null`,
      [id],
    );
    // If `id` belongs to a different tenant, RLS makes this row invisible —
    // the query returns zero rows, not a permission error and not someone
    // else's student. From the caller's point of view this is
    // indistinguishable from the id simply not existing, which is the
    // correct behavior: it does not confirm or deny that the id exists in
    // another tenant.
    if (rows.length === 0) {
      throw new NotFoundException(`Student ${id} not found`);
    }
    return rows[0];
  }

  async create(input: {
    schoolId: string;
    admissionNo: string;
    firstName: string;
    lastName: string;
  }): Promise<Student> {
    const rows = await this.db.query<Student>(
      `insert into students (tenant_id, school_id, admission_no, first_name, last_name)
       values (current_tenant_id(), $1, $2, $3, $4)
       returning *`,
      [input.schoolId, input.admissionNo, input.firstName, input.lastName],
    );
    // current_tenant_id() is the same SQL helper the RLS policies use
    // (see 0001_init_tenancy.sql) — using it here too means an INSERT can
    // never accidentally target a different tenant_id than the one the
    // session is scoped to, even if a caller tried to pass one in.
    return rows[0];
  }
}
