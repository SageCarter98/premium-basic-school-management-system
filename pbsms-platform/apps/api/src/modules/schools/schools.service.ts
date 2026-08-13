/**
 * schools.service.ts
 *
 * Copies the students.service.ts pattern exactly (see that file's header for
 * why no query here ever writes `tenant_id` into a WHERE/INSERT clause by
 * hand) — this is now the second proof that the pattern is repeatable, not a
 * one-off, per README.md's "copy this shape for new modules" instruction.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { CreateSchoolDto } from './dto/create-school.dto';

export interface School {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  level_scope: string;
  address: string | null;
}

@Injectable()
export class SchoolsService {
  constructor(private readonly db: TenantDatabaseService) {}

  async findAll(): Promise<School[]> {
    return this.db.query<School>(
      `select id, tenant_id, name, code, level_scope, address
       from schools
       where deleted_at is null
       order by name`,
    );
  }

  async findOne(id: string): Promise<School> {
    const rows = await this.db.query<School>(
      `select * from schools where id = $1 and deleted_at is null`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`School ${id} not found`);
    }
    return rows[0];
  }

  async create(input: CreateSchoolDto): Promise<School> {
    const rows = await this.db.query<School>(
      `insert into schools (tenant_id, name, code, level_scope, address)
       values (current_tenant_id(), $1, $2, coalesce($3, 'nursery_to_jhs'), $4)
       returning *`,
      [input.name, input.code, input.levelScope ?? null, input.address ?? null],
    );
    return rows[0];
  }
}
