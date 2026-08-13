/**
 * academic-years.service.ts
 *
 * Same pattern as students.service.ts / schools.service.ts: never write
 * tenant_id into a WHERE/INSERT clause by hand — RLS supplies it via
 * TenantDatabaseService (see tenant-database.service.ts).
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';

export interface AcademicYear {
  id: string;
  tenant_id: string;
  school_id: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

@Injectable()
export class AcademicYearsService {
  constructor(private readonly db: TenantDatabaseService) {}

  async findAll(): Promise<AcademicYear[]> {
    return this.db.query<AcademicYear>(
      `select id, tenant_id, school_id, name, status, start_date, end_date
       from academic_years
       where deleted_at is null
       order by start_date desc nulls last, name`,
    );
  }

  async findOne(id: string): Promise<AcademicYear> {
    const rows = await this.db.query<AcademicYear>(
      `select * from academic_years where id = $1 and deleted_at is null`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Academic year ${id} not found`);
    }
    return rows[0];
  }

  async create(input: CreateAcademicYearDto): Promise<AcademicYear> {
    const rows = await this.db.query<AcademicYear>(
      `insert into academic_years (tenant_id, school_id, name, status, start_date, end_date)
       values (current_tenant_id(), $1, $2, coalesce($3, 'planned'), $4, $5)
       returning *`,
      [input.schoolId, input.name, input.status ?? null, input.startDate ?? null, input.endDate ?? null],
    );
    return rows[0];
  }
}
