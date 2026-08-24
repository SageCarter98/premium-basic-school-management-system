/**
 * teacher-assignments.service.ts
 *
 * Implements SRS v2.1 Chapter 17.1's "Teacher Assignments" step and backs
 * FR-ASM-020 ("restrict score entry to teachers with an active assignment
 * for that class subject in the current term") — see
 * 0020_teacher_assignments.sql's header for scope notes (no Term entity,
 * no timetable-conflict detection). Chapter 21.1's "Class Teacher" concept
 * (is_class_teacher, 0039_class_teacher.sql) is now closed too — see
 * findClassTeacher() below.
 *
 * hasActiveAssignment() is the method assessment.service.ts's
 * upsertScore() calls to actually enforce FR-ASM-020 — the second
 * cross-module service call in this codebase after discipline's
 * contactGuardian() -> CommunicationService.
 */

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { ACADEMIC_ADMIN } from '../../common/auth/role-groups';

export interface TeacherAssignment {
  id: string;
  tenant_id: string;
  teacher_id: string;
  class_id: string;
  subject_id: string;
  academic_year_id: string;
  status: string;
  ended_at: string | null;
  ended_reason: string | null;
  is_class_teacher: boolean;
}

export interface TeacherScope {
  unrestricted: boolean;
  classIds: Set<string>;
  classTeacherOf: Set<string>;
  subjectPairs: Set<string>;
}

export interface TeacherAssignmentFilter {
  teacherId?: string;
  classId?: string;
  subjectId?: string;
  academicYearId?: string;
}

@Injectable()
export class TeacherAssignmentsService {
  constructor(private readonly db: TenantDatabaseService) {}

  async assign(input: {
    teacherId: string;
    classId: string;
    subjectId: string;
    academicYearId: string;
    isClassTeacher?: boolean;
  }): Promise<TeacherAssignment> {
    await this.assertIsTeacher(input.teacherId);

    const { userId } = TenantContextStore.current();
    // A double active-class-teacher assignment raises the DB's own
    // uq_teacher_assignments_active_class_teacher violation (0039) — same
    // un-pre-checked-raw-error posture this method already has for
    // uq_teacher_assignments_active_slot, not a new inconsistency.
    const rows = await this.db.query<TeacherAssignment>(
      `insert into teacher_assignments
         (tenant_id, teacher_id, class_id, subject_id, academic_year_id, is_class_teacher, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $6)
       returning *`,
      [input.teacherId, input.classId, input.subjectId, input.academicYearId, input.isClassTeacher ?? false, userId],
    );
    return rows[0];
  }

  /** Chapter 21.1 — the class-level homeroom teacher, if one is set for
   * this class+year. null, not a 404, when none is assigned: "no class
   * teacher yet" is a normal state, not an error. */
  async findClassTeacher(classId: string, academicYearId: string): Promise<TeacherAssignment | null> {
    const rows = await this.db.query<TeacherAssignment>(
      `select * from teacher_assignments
       where class_id = $1 and academic_year_id = $2 and is_class_teacher and status = 'active'
       limit 1`,
      [classId, academicYearId],
    );
    return rows[0] ?? null;
  }

  private isCallerAcademicAdmin(): boolean {
    const { roles } = TenantContextStore.current();
    return roles.some((r) => (ACADEMIC_ADMIN as readonly string[]).includes(r));
  }

  /** Chapter 13.3 record-level scoping: a non-admin caller only ever sees
   * their own assignments, regardless of what teacherId (if any) they
   * pass — this module's own header comment used to document this as a
   * known, deferred gap. */
  async findAll(filter: TeacherAssignmentFilter): Promise<TeacherAssignment[]> {
    if (!this.isCallerAcademicAdmin()) {
      const { userId } = TenantContextStore.current();
      filter = { ...filter, teacherId: userId };
    }
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.teacherId) {
      params.push(filter.teacherId);
      conditions.push(`teacher_id = $${params.length}`);
    }
    if (filter.classId) {
      params.push(filter.classId);
      conditions.push(`class_id = $${params.length}`);
    }
    if (filter.subjectId) {
      params.push(filter.subjectId);
      conditions.push(`subject_id = $${params.length}`);
    }
    if (filter.academicYearId) {
      params.push(filter.academicYearId);
      conditions.push(`academic_year_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
    return this.db.query<TeacherAssignment>(
      `select * from teacher_assignments ${where} order by created_at desc`,
      params,
    );
  }

  async findOne(id: string): Promise<TeacherAssignment> {
    const rows = await this.db.query<TeacherAssignment>(`select * from teacher_assignments where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Teacher assignment ${id} not found`);
    }
    if (!this.isCallerAcademicAdmin()) {
      const { userId } = TenantContextStore.current();
      if (rows[0].teacher_id !== userId) {
        throw new ForbiddenException(`Teacher assignment ${id} does not belong to you`);
      }
    }
    return rows[0];
  }

  async end(id: string, reason?: string): Promise<TeacherAssignment> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<TeacherAssignment>(
      `update teacher_assignments
       set status = 'ended', ended_at = now(), ended_reason = $2, updated_at = now(), updated_by = $3
       where id = $1 and status = 'active'
       returning *`,
      [id, reason ?? null, userId],
    );
    if (rows.length === 0) {
      // Distinguish "doesn't exist" from "exists but already ended" the
      // same way results.service.ts's state-machine guards do elsewhere.
      await this.findOne(id);
      throw new ConflictException(`Teacher assignment ${id} is already ended`);
    }
    return rows[0];
  }

  /** FR-ASM-020's actual enforcement point — called from
   * assessment.service.ts's upsertScore(). */
  async hasActiveAssignment(
    teacherId: string,
    classId: string,
    subjectId: string,
    academicYearId: string,
  ): Promise<boolean> {
    const rows = await this.db.query<{ hit: number }>(
      `select 1 as hit from teacher_assignments
       where teacher_id = $1 and class_id = $2 and subject_id = $3 and academic_year_id = $4 and status = 'active'
       limit 1`,
      [teacherId, classId, subjectId, academicYearId],
    );
    return rows.length > 0;
  }

  /** Chapter 13.3's "Assigned students" scope, applied at CLASS grain
   * (not a specific subject) — for write paths like attendance marking
   * and result submission where the check is "does this teacher teach
   * ANY subject in this class," not "this exact class+subject" the way
   * FR-ASM-020's score-entry check is. Deliberately still not restricted
   * to the class teacher specifically (is_class_teacher, 0039) — any
   * active assignment to the class, regardless of subject, is treated as
   * sufficient claim to act on it at this grain; a genuinely different,
   * narrower rule from what findClassTeacher() surfaces for display. */
  async hasAnyActiveAssignmentForClass(teacherId: string, classId: string, academicYearId: string): Promise<boolean> {
    const rows = await this.db.query<{ hit: number }>(
      `select 1 as hit from teacher_assignments
       where teacher_id = $1 and class_id = $2 and academic_year_id = $3 and status = 'active'
       limit 1`,
      [teacherId, classId, academicYearId],
    );
    return rows.length > 0;
  }

  /**
   * Chapter 13.3's "assigned students" record-relationship scope — the
   * read-side half that FR-ASM-020's write-side checks (hasActiveAssignment/
   * hasAnyActiveAssignmentForClass, above) never covered.
   *
   * Restriction applies ONLY when 'teacher' is the caller's SOLE role —
   * not merely "lacks ACADEMIC_ADMIN". Several endpoints this scope is
   * applied to (students.findAll() in particular) are ALL_STAFF-gated,
   * reachable by librarian/accountant/health_officer/storekeeper/
   * transport_officer too — none of those hold ACADEMIC_ADMIN either, but
   * all of them legitimately need the SAME unrestricted cross-cutting
   * reference-data access role-groups.ts's own ALL_STAFF comment already
   * documents (a librarian issuing a book still needs to look up any
   * student). A user holding 'teacher' PLUS another role (e.g. a teacher
   * who is also academic_coordinator) also stays unrestricted — the more
   * permissive role wins, same union-of-roles posture RolesGuard itself
   * already uses everywhere (`roles.some(...)`), not a new exception.
   *
   * For an actual pure-teacher caller, scope is computed from their own
   * active teacher_assignments rows:
   * - classIds: every class they hold ANY active assignment for (class or
   *   subject teacher) — the class-level boundary attendance/results
   *   reads use, since neither of those tables has a subject dimension.
   * - classTeacherOf: classes where they're the designated Class Teacher
   *   (is_class_teacher) — grants the FULL class picture (every subject's
   *   scores), not just their own.
   * - subjectPairs: `${classId}:${subjectId}` keys for their exact
   *   subject assignments — the boundary a plain subject teacher's
   *   assessment/score reads are held to for a class they don't head.
   *
   * Callers apply this themselves (a plain SQL filter, not a second
   * round-trip) — this method only computes the scope, once per request,
   * the same "compute once, filter in the query" shape every other
   * multi-row read in this codebase already uses.
   */
  async getCallerScope(): Promise<TeacherScope> {
    const { userId, roles } = TenantContextStore.current();
    const isPureTeacher = roles.length > 0 && roles.every((r) => r === 'teacher');
    if (!isPureTeacher) {
      return { unrestricted: true, classIds: new Set(), classTeacherOf: new Set(), subjectPairs: new Set() };
    }
    const rows = await this.db.query<{ class_id: string; subject_id: string; is_class_teacher: boolean }>(
      `select class_id, subject_id, is_class_teacher from teacher_assignments where teacher_id = $1 and status = 'active'`,
      [userId],
    );
    const classIds = new Set(rows.map((r) => r.class_id));
    const classTeacherOf = new Set(rows.filter((r) => r.is_class_teacher).map((r) => r.class_id));
    const subjectPairs = new Set(rows.map((r) => `${r.class_id}:${r.subject_id}`));
    return { unrestricted: false, classIds, classTeacherOf, subjectPairs };
  }

  private async assertIsTeacher(userId: string): Promise<void> {
    const rows = await this.db.query<{ hit: number }>(
      `select 1 as hit from tenant_users where user_id = $1 and role_code = 'teacher' limit 1`,
      [userId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`${userId} is not a real teacher in this tenant`);
    }
  }
}
