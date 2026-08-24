/**
 * enrolments.service.ts
 *
 * Same pattern as students.service.ts / schools.service.ts — never write
 * tenant_id into a WHERE/INSERT clause by hand, RLS supplies it. This is the
 * most relationship-heavy table added so far (student + academic year +
 * class, all three cross-checked against the caller's tenant by RLS on each
 * referenced table independently — see 0001_init_tenancy.sql's composite
 * foreign keys), which is why it's also the one extended in
 * test/tenant-isolation.e2e-spec.ts (BR: one active enrolment per student
 * per year, enforced by the migration's unique constraint, not here).
 */

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { CreateEnrolmentDto } from './dto/create-enrolment.dto';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

export interface Enrolment {
  id: string;
  tenant_id: string;
  student_id: string;
  academic_year_id: string;
  class_id: string;
  status: string;
  start_date: string;
  end_date: string | null;
}

@Injectable()
export class EnrolmentsService {
  constructor(private readonly db: TenantDatabaseService) {}

  async findAll(
    filter: { studentId?: string; academicYearId?: string; classId?: string } = {},
  ): Promise<Enrolment[]> {
    const conditions = ['deleted_at is null'];
    const params: string[] = [];
    if (filter.studentId) {
      params.push(filter.studentId);
      conditions.push(`student_id = $${params.length}`);
    }
    if (filter.academicYearId) {
      params.push(filter.academicYearId);
      conditions.push(`academic_year_id = $${params.length}`);
    }
    if (filter.classId) {
      params.push(filter.classId);
      conditions.push(`class_id = $${params.length}`);
    }
    return this.db.query<Enrolment>(
      `select id, tenant_id, student_id, academic_year_id, class_id, status, start_date, end_date
       from enrolments
       where ${conditions.join(' and ')}
       order by start_date desc`,
      params,
    );
  }

  async findOne(id: string): Promise<Enrolment> {
    const rows = await this.db.query<Enrolment>(
      `select * from enrolments where id = $1 and deleted_at is null`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Enrolment ${id} not found`);
    }
    return rows[0];
  }

  async create(input: CreateEnrolmentDto): Promise<Enrolment> {
    try {
      const rows = await this.db.query<Enrolment>(
        `insert into enrolments (tenant_id, student_id, academic_year_id, class_id)
         values (current_tenant_id(), $1, $2, $3)
         returning *`,
        [input.studentId, input.academicYearId, input.classId],
      );
      return rows[0];
    } catch (err: unknown) {
      // BR-ENR-001 (FR-STU rules): one active enrolment per student per
      // academic year — enforced by the migration's unique constraint. A
      // cross-tenant attempt to enrol another tenant's student/year/class
      // fails as a foreign-key violation instead, because RLS on the
      // referenced tables makes those ids invisible, not just disallowed.
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
        throw new ConflictException('Student already has an active enrolment for this academic year');
      }
      throw err;
    }
  }

  /** "Student assigning to class" as a standing operation, not just a
   * once-at-admission choice — transfers an already-enrolled student to a
   * different class within the same academic year. Only 'active'
   * enrolments can be reassigned; a closed/transferred enrolment is a
   * historical record, not something this endpoint corrects (same
   * "point-of-no-return" posture as every other terminal-status entity in
   * this codebase — reopen it via a dedicated path first if that's
   * genuinely needed, this isn't one). Deliberately caught as a clean
   * 400 rather than the raw 500 createFeeStructure() is flagged for in
   * apps/web/README.md — the (tenant_id, class_id) composite FK
   * (0001_init_tenancy.sql) is the only thing that would reject a
   * cross-tenant or nonexistent class id here. */
  async reassignClass(id: string, classId: string): Promise<Enrolment> {
    const current = await this.findOne(id);
    if (current.status !== 'active') {
      throw new ConflictException(`Enrolment ${id} is ${current.status}, not active — cannot reassign its class`);
    }
    const { userId } = TenantContextStore.current();
    try {
      const rows = await this.db.query<Enrolment>(
        `update enrolments set class_id = $1, updated_at = now(), updated_by = $2
         where id = $3 and deleted_at is null
         returning *`,
        [classId, userId, id],
      );
      return rows[0];
    } catch (err: unknown) {
      if (isPgError(err) && err.code === FOREIGN_KEY_VIOLATION) {
        throw new BadRequestException(`Class ${classId} does not exist for this tenant`);
      }
      throw err;
    }
  }
}

function isPgError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}
