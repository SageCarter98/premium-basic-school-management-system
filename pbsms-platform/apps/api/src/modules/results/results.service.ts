/**
 * results.service.ts
 *
 * Implements SRS v2.1 Chapter 21 (Results Management Engine, FR-RES-010..050).
 * Reads grading's result_candidates (0005_grading.sql) but only ever
 * SNAPSHOTS them into student_result_items — see 0006_results.sql's header
 * for why a live join would violate FR-RES-030 ("published results are
 * never overwritten"). That snapshot only happens in create() and the
 * explicit resync() — never silently inside publish() or any status
 * transition, so "what does this published result show" never depends on
 * when you happen to read it.
 *
 * reopen() is the one method here that doesn't fit the "check status, flip
 * a column" shape every other transition uses: FR-RES-030 requires the old
 * published/locked row to be preserved exactly as it was, so reopening
 * INSERTs a new row (version+1) instead. The old row's superseded_at is
 * set BEFORE the new row is inserted, both inside one transaction — doing
 * it in the other order would (briefly, until commit) leave two
 * non-superseded rows for the same student+class+year, which
 * 0006_results.sql's partial unique index exists specifically to make
 * impossible, including under concurrency.
 */

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { TeacherAssignmentsService } from '../teacher-assignments/teacher-assignments.service';
import { ACADEMIC_ADMIN } from '../../common/auth/role-groups';
import { CreateStudentResultDto } from './dto/create-student-result.dto';
import { ReturnResultDto } from './dto/return-result.dto';
import { ReopenResultDto } from './dto/reopen-result.dto';

export interface StudentResult {
  id: string;
  tenant_id: string;
  student_id: string;
  class_id: string;
  academic_year_id: string;
  version: number;
  previous_version_id: string | null;
  status: string;
  submitted_at: string | null;
  submitted_by: string | null;
  returned_at: string | null;
  returned_by: string | null;
  return_reason: string | null;
  corrected_at: string | null;
  corrected_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  published_at: string | null;
  published_by: string | null;
  locked_at: string | null;
  locked_by: string | null;
  archived_at: string | null;
  archived_by: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string | null;
  superseded_at: string | null;
  average_percentage: string | null;
  subjects_failed_count: number;
  overall_pass: boolean | null;
}

export interface StudentResultItem {
  id: string;
  tenant_id: string;
  student_result_id: string;
  subject_id: string;
  subject_name: string;
  grading_policy_id: string;
  percentage: string;
  grade: string;
  point: string | null;
  remark: string | null;
  is_pass: boolean;
  source_result_candidate_id: string | null;
}

export interface ClassAnalytics {
  class_average: string | null;
  pass_rate_percentage: string | null;
  student_count: string;
}

interface GradedSubjectRow {
  subject_id: string;
  subject_name: string;
  candidate_id: string;
  grading_policy_id: string;
  percentage: string;
  grade: string;
  point: string | null;
  remark: string | null;
  is_pass: boolean;
}

const PUBLISHED_VISIBLE_STATUSES = ['published', 'locked', 'archived'];

function isPgError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

@Injectable()
export class ResultsService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly teacherAssignments: TeacherAssignmentsService,
  ) {}

  async create(input: CreateStudentResultDto): Promise<StudentResult> {
    const { userId } = TenantContextStore.current();
    try {
      const rows = await this.db.query<StudentResult>(
        `insert into student_results (tenant_id, student_id, class_id, academic_year_id, version, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, 1, $4, $4)
         returning *`,
        [input.studentId, input.classId, input.academicYearId, userId],
      );
      const created = rows[0];
      await this.snapshotItems(created.id, input.studentId, input.classId, input.academicYearId);
      return this.findOne(created.id);
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        throw new ConflictException(
          `Student ${input.studentId} already has a current result for this class+year — use reopen() on the existing one instead`,
        );
      }
      throw err;
    }
  }

  /** Chapter 13.3 scope, class-level like attendance (results compile
   * every subject for a student+class+year, so there's no per-subject
   * boundary to hold a subject teacher to here) — any active assignment
   * for the class, class-teacher or subject teacher alike, matches the
   * same hasAnyActiveAssignmentForClass() boundary submit() already
   * enforces on the write side. */
  async findAll(): Promise<StudentResult[]> {
    const rows = await this.db.query<StudentResult>(`select * from student_results order by created_at desc`);
    const scope = await this.teacherAssignments.getCallerScope();
    if (scope.unrestricted) return rows;
    return rows.filter((r) => scope.classIds.has(r.class_id));
  }

  async findOne(id: string): Promise<StudentResult> {
    const rows = await this.db.query<StudentResult>(`select * from student_results where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Student result ${id} not found`);
    }
    const result = rows[0];
    const scope = await this.teacherAssignments.getCallerScope();
    if (!scope.unrestricted && !scope.classIds.has(result.class_id)) {
      throw new NotFoundException(`Student result ${id} not found`);
    }
    return result;
  }

  async findItems(studentResultId: string): Promise<StudentResultItem[]> {
    await this.findOne(studentResultId); // cascades the Chapter 13.3 scope check, 404s if out of scope
    return this.db.query<StudentResultItem>(
      `select * from student_result_items where student_result_id = $1 order by subject_name`,
      [studentResultId],
    );
  }

  /** FR-RES-040: guardians/students see only published (or later-stage)
   * results — never a draft still being compiled or a version mid-review.
   * Deliberately NOT teacher-scoped — parent-view.service.ts reuses this
   * exact method for a guardian's own token-authenticated request, which
   * has no teacher_assignments of its own (getCallerScope() would compute
   * an empty scope and hide everything). findPublishedForStudentAsStaff()
   * below is the teacher-scoped variant for the staff-facing endpoint. */
  async findPublishedForStudent(studentId: string): Promise<StudentResult[]> {
    return this.db.query<StudentResult>(
      `select * from student_results
       where student_id = $1 and status = any($2::text[]) and superseded_at is null
       order by academic_year_id`,
      [studentId, PUBLISHED_VISIBLE_STATUSES],
    );
  }

  /** The staff-facing counterpart to findPublishedForStudent() (Student
   * Profile's Academics tab, GET /v1/results/students/:studentId) — same
   * published-only data, but additionally scoped to the caller's own
   * classes per Chapter 13.3, unlike the guardian-facing method above. */
  async findPublishedForStudentAsStaff(studentId: string): Promise<StudentResult[]> {
    const rows = await this.findPublishedForStudent(studentId);
    const scope = await this.teacherAssignments.getCallerScope();
    if (scope.unrestricted) return rows;
    return rows.filter((r) => scope.classIds.has(r.class_id));
  }

  /** FR-RES-050 subset — class-average/pass-rate only; student-trend,
   * division-comparison, promotion-readiness and the BECE mock-exam view
   * are documented future scope (see this module's header comment),
   * genuinely separate reporting features rather than a variation on this
   * query. Scoped to published-or-later results only — an in-progress
   * draft shouldn't move a headline "class average" figure. */
  async classAnalytics(classId: string, academicYearId: string): Promise<ClassAnalytics> {
    const scope = await this.teacherAssignments.getCallerScope();
    if (!scope.unrestricted && !scope.classIds.has(classId)) {
      throw new NotFoundException(`Class ${classId} not found`);
    }
    const rows = await this.db.query<ClassAnalytics>(
      `select
         avg(average_percentage) as class_average,
         avg(case when overall_pass then 100.0 else 0 end) as pass_rate_percentage,
         count(*) as student_count
       from student_results
       where class_id = $1 and academic_year_id = $2
         and status = any($3::text[]) and superseded_at is null`,
      [classId, academicYearId, PUBLISHED_VISIBLE_STATUSES],
    );
    return rows[0];
  }

  /** draft/returned/corrected only — see class header comment on why this
   * is a distinct, explicit action rather than something publish() does
   * implicitly. */
  async resync(id: string): Promise<StudentResult> {
    const result = await this.findOne(id);
    if (!['draft', 'returned', 'corrected'].includes(result.status)) {
      throw new ConflictException(`Cannot resync result ${id}: it is '${result.status}', not draft/returned/corrected`);
    }
    await this.snapshotItems(id, result.student_id, result.class_id, result.academic_year_id);
    return this.findOne(id);
  }

  async submit(id: string): Promise<StudentResult> {
    const { userId, roles } = TenantContextStore.current();
    const result = await this.findOne(id);
    if (!['draft', 'corrected'].includes(result.status)) {
      throw new ConflictException(`Cannot submit result ${id}: it is '${result.status}', not draft/corrected`);
    }

    // Chapter 13.3 "assigned students" scope, class grain — same
    // ACADEMIC_ADMIN-override shape as FR-ASM-020's score entry and
    // attendance.service.ts's sync(). A subject teacher submits their
    // own class's result; a coordinator/headmaster can submit on behalf
    // of any class.
    const isAcademicAdmin = roles.some((r) => (ACADEMIC_ADMIN as string[]).includes(r));
    if (!isAcademicAdmin) {
      const assigned = await this.teacherAssignments.hasAnyActiveAssignmentForClass(
        userId,
        result.class_id,
        result.academic_year_id,
      );
      if (!assigned) {
        throw new ForbiddenException(
          `You do not have an active teacher assignment for class ${result.class_id}`,
        );
      }
    }
    const items = await this.findItems(id);
    if (items.length === 0) {
      throw new ConflictException(
        `Cannot submit result ${id}: it has no graded subjects — call resync() once grading is complete`,
      );
    }
    const rows = await this.db.query<StudentResult>(
      `update student_results set status = 'submitted', submitted_at = now(), submitted_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  async returnForCorrection(id: string, input: ReturnResultDto): Promise<StudentResult> {
    const { userId } = TenantContextStore.current();
    const result = await this.findOne(id);
    // 'approved' is included alongside 'submitted'/'reviewed' so a problem
    // spotted after headmaster approval but before publish() still has a
    // way back to draft — without it, 'approved' would be a dead end: the
    // only other route out is publish() itself, and reopen() only accepts
    // published/locked, not approved. Caught live: an 'approved' result
    // whose class gained a newly-graded subject had no way to pick it up.
    if (!['submitted', 'reviewed', 'approved'].includes(result.status)) {
      throw new ConflictException(
        `Cannot return result ${id}: it is '${result.status}', not submitted/reviewed/approved`,
      );
    }
    const rows = await this.db.query<StudentResult>(
      `update student_results
       set status = 'returned', returned_at = now(), returned_by = $1, return_reason = $2
       where id = $3
       returning *`,
      [userId, input.reason, id],
    );
    return rows[0];
  }

  async correct(id: string): Promise<StudentResult> {
    const { userId } = TenantContextStore.current();
    const result = await this.findOne(id);
    if (result.status !== 'returned') {
      throw new ConflictException(`Cannot mark result ${id} corrected: it is '${result.status}', not returned`);
    }
    const rows = await this.db.query<StudentResult>(
      `update student_results set status = 'corrected', corrected_at = now(), corrected_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  /** Optional per 21.1's workflow — approve() also accepts 'submitted'
   * directly so a headmaster can skip this step entirely. */
  async review(id: string): Promise<StudentResult> {
    const { userId } = TenantContextStore.current();
    const result = await this.findOne(id);
    if (result.status !== 'submitted') {
      throw new ConflictException(`Cannot review result ${id}: it is '${result.status}', not submitted`);
    }
    const rows = await this.db.query<StudentResult>(
      `update student_results set status = 'reviewed', reviewed_at = now(), reviewed_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  async approve(id: string): Promise<StudentResult> {
    const { userId } = TenantContextStore.current();
    const result = await this.findOne(id);
    if (!['submitted', 'reviewed'].includes(result.status)) {
      throw new ConflictException(`Cannot approve result ${id}: it is '${result.status}', not submitted/reviewed`);
    }
    const rows = await this.db.query<StudentResult>(
      `update student_results set status = 'approved', approved_at = now(), approved_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  /**
   * FR-RES-020: publication requires every currently-published assessment
   * structure for this student_result's class+year to have a matching
   * snapshotted item — see this module's header for exactly what
   * "required subjects resolved" is simplified to here. `for update` locks
   * the row for the same reason assessment.service.ts's publish() does:
   * this validates against sibling data (the class's published structures)
   * before flipping status, and a concurrent reopen()/resync() must not be
   * able to interleave with that.
   */
  async publish(id: string): Promise<StudentResult> {
    const { userId } = TenantContextStore.current();
    await this.db.query('BEGIN');
    try {
      const resultRows = await this.db.query<StudentResult>(
        `select * from student_results where id = $1 for update`,
        [id],
      );
      if (resultRows.length === 0) {
        throw new NotFoundException(`Student result ${id} not found`);
      }
      const result = resultRows[0];
      if (result.status !== 'approved') {
        throw new ConflictException(`Cannot publish result ${id}: it is '${result.status}', not approved`);
      }

      const missing = await this.db.query<{ subject_name: string }>(
        `select s.name as subject_name
         from assessment_structures ast
         join subjects s on s.id = ast.subject_id
         where ast.class_id = $1 and ast.academic_year_id = $2 and ast.status = 'published' and ast.deleted_at is null
           and not exists (
             select 1 from student_result_items sri
             where sri.student_result_id = $3 and sri.subject_id = ast.subject_id
           )`,
        [result.class_id, result.academic_year_id, id],
      );
      if (missing.length > 0) {
        throw new ConflictException(
          `Cannot publish result ${id}: missing snapshotted subjects [${missing.map((m) => m.subject_name).join(', ')}] — call resync() once grading is complete (FR-RES-020)`,
        );
      }

      const updatedRows = await this.db.query<StudentResult>(
        `update student_results set status = 'published', published_at = now(), published_by = $1 where id = $2 returning *`,
        [userId, id],
      );
      await this.db.query('COMMIT');
      return updatedRows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  async lock(id: string): Promise<StudentResult> {
    const { userId } = TenantContextStore.current();
    const result = await this.findOne(id);
    if (result.status !== 'published') {
      throw new ConflictException(`Cannot lock result ${id}: it is '${result.status}', not published`);
    }
    const rows = await this.db.query<StudentResult>(
      `update student_results set status = 'locked', locked_at = now(), locked_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  async archive(id: string): Promise<StudentResult> {
    const { userId } = TenantContextStore.current();
    const result = await this.findOne(id);
    if (result.status !== 'locked') {
      throw new ConflictException(`Cannot archive result ${id}: it is '${result.status}', not locked`);
    }
    const rows = await this.db.query<StudentResult>(
      `update student_results set status = 'archived', archived_at = now(), archived_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  /** See class header comment for why this creates a new row instead of
   * mutating the existing one, and why superseded_at is set before the
   * new row is inserted, not after. */
  async reopen(id: string, input: ReopenResultDto): Promise<StudentResult> {
    const { userId } = TenantContextStore.current();
    await this.db.query('BEGIN');
    try {
      const oldRows = await this.db.query<StudentResult>(
        `select * from student_results where id = $1 for update`,
        [id],
      );
      if (oldRows.length === 0) {
        throw new NotFoundException(`Student result ${id} not found`);
      }
      const old = oldRows[0];
      if (!['published', 'locked'].includes(old.status)) {
        throw new ConflictException(`Cannot reopen result ${id}: it is '${old.status}', not published/locked`);
      }

      // Superseding the old row BEFORE inserting the new one is required:
      // 0006_results.sql's partial unique index allows only one row per
      // student+class+year with superseded_at IS NULL, so doing this in
      // the other order would violate it (even momentarily, within this
      // same transaction).
      await this.db.query(`update student_results set superseded_at = now() where id = $1`, [id]);

      const newRows = await this.db.query<StudentResult>(
        `insert into student_results
           (tenant_id, student_id, class_id, academic_year_id, version, previous_version_id, status,
            reopened_at, reopened_by, reopen_reason, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $5, 'draft', now(), $6, $7, $6, $6)
         returning *`,
        [old.student_id, old.class_id, old.academic_year_id, old.version + 1, old.id, userId, input.reason],
      );
      const created = newRows[0];

      await this.snapshotItems(created.id, old.student_id, old.class_id, old.academic_year_id);

      await this.db.query('COMMIT');
      return this.findOne(created.id);
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  /**
   * Upserts student_result_items from every currently-published
   * assessment structure (for this class+year) that has a result_candidate
   * for this student, then prunes any previously-snapshotted item whose
   * subject is no longer in that set (e.g. a structure got reopened back
   * to draft after an earlier snapshot), then recomputes the parent row's
   * aggregate fields. Never called from publish() itself — see class
   * header comment.
   */
  private async snapshotItems(
    studentResultId: string,
    studentId: string,
    classId: string,
    academicYearId: string,
  ): Promise<void> {
    const { userId } = TenantContextStore.current();

    const graded = await this.db.query<GradedSubjectRow>(
      `select ast.subject_id, s.name as subject_name, rc.id as candidate_id, rc.grading_policy_id,
              rc.percentage, rc.grade, rc.point, rc.remark, rc.is_pass
       from assessment_structures ast
       join subjects s on s.id = ast.subject_id
       join result_candidates rc on rc.assessment_structure_id = ast.id and rc.student_id = $3
       where ast.class_id = $1 and ast.academic_year_id = $2 and ast.status = 'published' and ast.deleted_at is null`,
      [classId, academicYearId, studentId],
    );

    for (const row of graded) {
      await this.db.query(
        `insert into student_result_items
           (tenant_id, student_result_id, subject_id, subject_name, grading_policy_id, percentage, grade, point, remark, is_pass, source_result_candidate_id)
         values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (tenant_id, student_result_id, subject_id)
         do update set subject_name = $3, grading_policy_id = $4, percentage = $5, grade = $6, point = $7,
                        remark = $8, is_pass = $9, source_result_candidate_id = $10`,
        [
          studentResultId,
          row.subject_id,
          row.subject_name,
          row.grading_policy_id,
          row.percentage,
          row.grade,
          row.point,
          row.remark,
          row.is_pass,
          row.candidate_id,
        ],
      );
    }

    const currentSubjectIds = graded.map((r) => r.subject_id);
    await this.db.query(
      `delete from student_result_items where student_result_id = $1 and subject_id != all($2::uuid[])`,
      [studentResultId, currentSubjectIds],
    );

    const failedCount = graded.filter((r) => !r.is_pass).length;
    const averagePercentage =
      graded.length === 0 ? null : graded.reduce((sum, r) => sum + Number(r.percentage), 0) / graded.length;
    const overallPass = graded.length === 0 ? null : failedCount === 0;

    await this.db.query(
      `update student_results
       set average_percentage = $1, subjects_failed_count = $2, overall_pass = $3, updated_at = now(), updated_by = $4
       where id = $5`,
      [averagePercentage, failedCount, overallPass, userId, studentResultId],
    );
  }
}
