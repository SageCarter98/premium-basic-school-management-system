/**
 * staff-feedback.service.ts
 *
 * Closes the "individual role feedbacks should be forwarded to school
 * admin for review then either accept, reject or place on hold" gap —
 * see 0044_staff_feedback.sql's header. Any authenticated staff member
 * submits; ACADEMIC_ADMIN (the same tier every other senior/
 * administrative review action in this codebase uses) triages.
 *
 * State machine mirrors admissions.service.ts's ALLOWED_TRANSITIONS shape
 * exactly: a table, checked explicitly here (not a DB CHECK constraint,
 * which can't express "only from state X"). 'on_hold' is deliberately
 * NOT terminal — it can go back to 'submitted', the same
 * "a workflow state needs a way back or it's a dead end" lesson this
 * codebase has re-applied several times now (results.reopen(),
 * discipline's closed->investigating, communication's
 * reopened->in_progress).
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { CreateStaffFeedbackDto } from './dto/create-staff-feedback.dto';

export interface StaffFeedback {
  id: string;
  tenant_id: string;
  submitted_by: string;
  subject: string;
  message: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  admin_notes: string | null;
  created_at: string;
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  submitted: ['accepted', 'rejected', 'on_hold'],
  on_hold: ['accepted', 'rejected', 'submitted'],
  accepted: [],
  rejected: [],
};

@Injectable()
export class StaffFeedbackService {
  constructor(private readonly db: TenantDatabaseService) {}

  async create(input: CreateStaffFeedbackDto): Promise<StaffFeedback> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<StaffFeedback>(
      `insert into staff_feedback (tenant_id, submitted_by, subject, message)
       values (current_tenant_id(), $1, $2, $3)
       returning *`,
      [userId, input.subject, input.message],
    );
    return rows[0];
  }

  /** ALL_STAFF read, but scoped to "my own submissions" for anyone below
   * ACADEMIC_ADMIN — a plain teacher shouldn't see a colleague's feedback,
   * only school leadership reviewing the whole queue should. Mirrors the
   * same "restrict unless the caller is in the review tier" shape
   * TeacherAssignmentsService.getCallerScope() established for Chapter
   * 13.3, just simpler here (no assignment table to compute from — every
   * caller either sees everything or only their own rows). */
  async findAll(isReviewer: boolean): Promise<StaffFeedback[]> {
    if (isReviewer) {
      return this.db.query<StaffFeedback>(`select * from staff_feedback order by created_at desc`);
    }
    const { userId } = TenantContextStore.current();
    return this.db.query<StaffFeedback>(
      `select * from staff_feedback where submitted_by = $1 order by created_at desc`,
      [userId],
    );
  }

  async findOne(id: string): Promise<StaffFeedback> {
    const rows = await this.db.query<StaffFeedback>(`select * from staff_feedback where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Feedback ${id} not found`);
    }
    return rows[0];
  }

  private async transition(id: string, status: string, adminNotes?: string): Promise<StaffFeedback> {
    const feedback = await this.findOne(id);
    const allowed = ALLOWED_TRANSITIONS[feedback.status] ?? [];
    if (!allowed.includes(status)) {
      throw new ConflictException(
        `Cannot move feedback ${id} from '${feedback.status}' to '${status}' (allowed: ${allowed.join(', ') || 'none'})`,
      );
    }
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<StaffFeedback>(
      `update staff_feedback set
         status = $1,
         reviewed_by = $2,
         reviewed_at = now(),
         admin_notes = coalesce($3, admin_notes),
         updated_at = now()
       where id = $4
       returning *`,
      [status, userId, adminNotes ?? null, id],
    );
    return rows[0];
  }

  accept(id: string, adminNotes?: string): Promise<StaffFeedback> {
    return this.transition(id, 'accepted', adminNotes);
  }

  reject(id: string, adminNotes?: string): Promise<StaffFeedback> {
    return this.transition(id, 'rejected', adminNotes);
  }

  hold(id: string, adminNotes?: string): Promise<StaffFeedback> {
    return this.transition(id, 'on_hold', adminNotes);
  }

  /** The explicit way back from 'on_hold' — see class header. */
  reopen(id: string, adminNotes?: string): Promise<StaffFeedback> {
    return this.transition(id, 'submitted', adminNotes);
  }
}
