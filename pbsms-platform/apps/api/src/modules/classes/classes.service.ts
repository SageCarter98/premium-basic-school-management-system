/**
 * classes.service.ts
 *
 * Same pattern as students.service.ts / schools.service.ts — never write
 * tenant_id into a WHERE/INSERT clause by hand, RLS supplies it.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { CreateClassDto } from './dto/create-class.dto';

export interface SchoolClass {
  id: string;
  tenant_id: string;
  academic_year_id: string;
  name: string;
  level: string;
}

@Injectable()
export class ClassesService {
  constructor(private readonly db: TenantDatabaseService) {}

  async findAll(): Promise<SchoolClass[]> {
    return this.db.query<SchoolClass>(
      `select id, tenant_id, academic_year_id, name, level
       from classes
       where deleted_at is null
       order by level, name`,
    );
  }

  async findOne(id: string): Promise<SchoolClass> {
    const rows = await this.db.query<SchoolClass>(
      `select * from classes where id = $1 and deleted_at is null`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Class ${id} not found`);
    }
    return rows[0];
  }

  async create(input: CreateClassDto): Promise<SchoolClass> {
    const rows = await this.db.query<SchoolClass>(
      `insert into classes (tenant_id, academic_year_id, name, level)
       values (current_tenant_id(), $1, $2, $3)
       returning *`,
      [input.academicYearId, input.name, input.level],
    );
    return rows[0];
  }
}
