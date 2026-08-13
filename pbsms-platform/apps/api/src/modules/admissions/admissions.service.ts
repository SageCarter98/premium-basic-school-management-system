/**
 * admissions.service.ts
 *
 * Implements SRS v2.1 Chapter 15 (FR-ADM-010..050). Same tenant-scoping
 * pattern as every other service in this codebase — see
 * students.service.ts's header — but this is also the first module to
 * demonstrate an explicit multi-statement transaction boundary
 * (NFR-API-010: "explicit transaction boundaries ... for the right
 * operations — admission conversion, enrolment, ..."). TenantDatabaseService
 * is request-scoped and reuses one checked-out PoolClient for the whole
 * request (see its header comment), so plain BEGIN/COMMIT/ROLLBACK via
 * db.query() below is a real transaction, not three independent queries
 * that happen to run close together.
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { CreateApplicantDto } from './dto/create-applicant.dto';
import { ConvertApplicantDto } from './dto/convert-applicant.dto';

export interface Applicant {
  id: string;
  tenant_id: string;
  school_id: string;
  first_name: string;
  last_name: string;
  dob: string | null;
  gender: string | null;
  previous_school: string | null;
  status: string;
  possible_duplicate_of: string | null;
  admission_no: string | null;
  student_id: string | null;
}

export interface ConversionResult {
  applicant: Applicant;
  studentId: string;
  enrolmentId: string;
}

// FR-ADM 15.2's state machine. 'admitted' has no entry here as a target of
// a plain status update — see update-applicant-status.dto.ts — it is only
// reachable through convert() below, which checks 'approved' explicitly
// rather than consulting this table.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['under_review', 'cancelled'],
  under_review: ['documents_incomplete', 'interview_scheduled', 'waitlisted', 'approved', 'rejected', 'cancelled'],
  documents_incomplete: ['under_review', 'cancelled'],
  interview_scheduled: ['under_review', 'waitlisted', 'approved', 'rejected', 'cancelled'],
  waitlisted: ['under_review', 'approved', 'rejected', 'cancelled'],
  approved: ['cancelled'],
  rejected: [],
  admitted: [],
  cancelled: [],
};

@Injectable()
export class AdmissionsService {
  constructor(private readonly db: TenantDatabaseService) {}

  async findAll(): Promise<Applicant[]> {
    return this.db.query<Applicant>(
      `select * from applicants where deleted_at is null order by created_at desc`,
    );
  }

  async findOne(id: string): Promise<Applicant> {
    const rows = await this.db.query<Applicant>(
      `select * from applicants where id = $1 and deleted_at is null`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Applicant ${id} not found`);
    }
    return rows[0];
  }

  async create(input: CreateApplicantDto): Promise<Applicant> {
    // FR-ADM-020: surfaced for review, never auto-discarded — this is a
    // same-tenant lookup only (RLS already guarantees that; no explicit
    // tenant_id filter needed, same as every other query in this codebase).
    const dupRows = await this.db.query<{ id: string }>(
      `select id from applicants
       where lower(first_name) = lower($1) and lower(last_name) = lower($2)
         and dob is not distinct from $3
         and status not in ('rejected', 'cancelled')
         and deleted_at is null
       limit 1`,
      [input.firstName, input.lastName, input.dob ?? null],
    );
    const possibleDuplicateOf = dupRows[0]?.id ?? null;

    const rows = await this.db.query<Applicant>(
      `insert into applicants
         (tenant_id, school_id, first_name, last_name, dob, gender, previous_school, possible_duplicate_of)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [
        input.schoolId,
        input.firstName,
        input.lastName,
        input.dob ?? null,
        input.gender ?? null,
        input.previousSchool ?? null,
        possibleDuplicateOf,
      ],
    );
    return rows[0];
  }

  async updateStatus(id: string, status: string): Promise<Applicant> {
    const applicant = await this.findOne(id);
    const allowed = ALLOWED_TRANSITIONS[applicant.status] ?? [];
    if (!allowed.includes(status)) {
      throw new ConflictException(
        `Cannot move applicant from '${applicant.status}' to '${status}' (allowed: ${allowed.join(', ') || 'none'})`,
      );
    }
    const rows = await this.db.query<Applicant>(
      `update applicants set status = $1 where id = $2 returning *`,
      [status, id],
    );
    return rows[0];
  }

  /**
   * FR-ADM-030/040: approval-to-student conversion as one atomic
   * transaction, admission number assigned only here and never reused.
   *
   * Idempotency note (NFR-API-010): this deliberately does NOT use a
   * generic idempotency-key header/table — that's separate infrastructure
   * better built once, for every sensitive operation, not bolted onto this
   * one. Instead it relies on the state check below: once conversion
   * succeeds the applicant is no longer 'approved', so a retried call with
   * the same applicant id fails closed (ConflictException) rather than
   * creating a second student. That's sufficient for THIS operation
   * because it's a one-way transition; it would not be sufficient for an
   * operation retried before its first attempt's transaction commits
   * (e.g. two truly concurrent requests) — the `for update` lock below
   * covers that narrower case by serializing concurrent converts of the
   * *same* applicant.
   */
  async convert(id: string, input: ConvertApplicantDto): Promise<ConversionResult> {
    await this.db.query('BEGIN');
    try {
      const applicantRows = await this.db.query<Applicant>(
        `select * from applicants where id = $1 and deleted_at is null for update`,
        [id],
      );
      if (applicantRows.length === 0) {
        throw new NotFoundException(`Applicant ${id} not found`);
      }
      const applicant = applicantRows[0];
      if (applicant.status !== 'approved') {
        throw new ConflictException(
          `Applicant must be 'approved' to convert (current status: '${applicant.status}')`,
        );
      }

      const schoolRows = await this.db.query<{ code: string }>(
        `select code from schools where id = $1`,
        [applicant.school_id],
      );
      if (schoolRows.length === 0) {
        throw new NotFoundException(`School ${applicant.school_id} not found`);
      }
      const schoolCode = schoolRows[0].code;

      // Simplified sequence source for a scaffold: count existing students
      // for this school+year. A production implementation would want a
      // proper per-tenant counter table for guaranteed monotonic
      // uniqueness under concurrency; the unique constraint on
      // students(tenant_id, admission_no) is the safety net here — a race
      // becomes a clean transaction failure, never a silent duplicate.
      const year = new Date().getUTCFullYear();
      const prefix = `${schoolCode}-${year}-`;
      const countRows = await this.db.query<{ count: string }>(
        `select count(*) from students where school_id = $1 and admission_no like $2`,
        [applicant.school_id, `${prefix}%`],
      );
      const seq = Number(countRows[0].count) + 1;
      const admissionNo = `${prefix}${String(seq).padStart(3, '0')}`;

      const studentRows = await this.db.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, dob, gender)
         values (current_tenant_id(), $1, $2, $3, $4, $5, $6)
         returning id`,
        [applicant.school_id, admissionNo, applicant.first_name, applicant.last_name, applicant.dob, applicant.gender],
      );
      const studentId = studentRows[0].id;

      const enrolmentRows = await this.db.query<{ id: string }>(
        `insert into enrolments (tenant_id, student_id, academic_year_id, class_id)
         values (current_tenant_id(), $1, $2, $3)
         returning id`,
        [studentId, input.academicYearId, input.classId],
      );
      const enrolmentId = enrolmentRows[0].id;

      const updatedRows = await this.db.query<Applicant>(
        `update applicants set status = 'admitted', admission_no = $1, student_id = $2
         where id = $3
         returning *`,
        [admissionNo, studentId, id],
      );

      await this.db.query('COMMIT');
      return { applicant: updatedRows[0], studentId, enrolmentId };
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }
}
