/**
 * teacher-assignments.service.ts
 *
 * Implements SRS v2.1 Chapter 17.1's "Teacher Assignments" step and backs
 * FR-ASM-020 ("restrict score entry to teachers with an active assignment
 * for that class subject in the current term") — see
 * 0020_teacher_assignments.sql's header for scope notes (no Term entity,
 * no is_class_teacher, no timetable-conflict detection).
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
  }): Promise<TeacherAssignment> {
    await this.assertIsTeacher(input.teacherId);

    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<TeacherAssignment>(
      `insert into teacher_assignments
         (tenant_id, teacher_id, class_id, subject_id, academic_year_id, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $5)
       returning *`,
      [input.teacherId, input.classId, input.subjectId, input.academicYearId, userId],
    );
    return rows[0];
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
   * FR-ASM-020's score-entry check is. This schema has no separate
   * "Class Teacher" role distinct from a subject assignment
   * (0020_teacher_assignments.sql's header already documents that
   * deferral) — any active assignment to the class, regardless of
   * subject, is treated as sufficient claim to act on it at this grain. */
  async hasAnyActiveAssignmentForClass(teacherId: string, classId: string, academicYearId: string): Promise<boolean> {
    const rows = await this.db.query<{ hit: number }>(
      `select 1 as hit from teacher_assignments
       where teacher_id = $1 and class_id = $2 and academic_year_id = $3 and status = 'active'
       limit 1`,
      [teacherId, classId, academicYearId],
    );
    return rows.length > 0;
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
