/**
 * discipline.service.ts
 *
 * Implements SRS v2.1 Chapter 28 (FR-OPS-040) and its student-lifecycle
 * restatement (FR-STU-040). See 0011_discipline.sql's header for the full
 * scope-cut list (no separate follow-up table — case notes serve that
 * role; role/record-level scoping deferred like every other module;
 * retention documented, not enforced).
 *
 * Case status machine:
 *   reported -> investigating -> response_issued -> closed
 *                                       \-> appealed -> closed
 *   closed -> investigating (reopenCase() — an explicit way back, the
 *   same lesson results.service.ts's reopen() and communication's
 *   startReport() already applied: a "point of no return" state needs a
 *   traced exit, not just a happy-path chain).
 *
 * contactGuardian() is the one place this module calls into another
 * module's service (CommunicationService) rather than reinventing
 * dispatch — FR-COM-050's "discipline-related communication uses
 * stricter minimization and channel restriction" is already implemented
 * there as the 'confidential' sensitivity chain (email only, regardless
 * of channel requested); reusing it keeps that rule enforced in exactly
 * one place.
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { CommunicationService } from '../communication/communication.service';
import { StaffService } from '../staff/staff.service';
import { GuardiansService } from '../guardians/guardians.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { AddNoteDto } from './dto/add-note.dto';
import { IssueResponseDto } from './dto/issue-response.dto';
import { ContactGuardianDto } from './dto/contact-guardian.dto';
import { FileAppealDto } from './dto/file-appeal.dto';
import { DecideAppealDto } from './dto/decide-appeal.dto';
import { CreateRecognitionDto } from './dto/create-recognition.dto';

export interface DisciplineCase {
  id: string;
  tenant_id: string;
  student_id: string;
  category: string;
  severity: string;
  incident_date: string;
  description: string;
  reported_by: string;
  status: string;
  closed_at: string | null;
  reopened_at: string | null;
}

export interface DisciplineCaseNote {
  id: string;
  tenant_id: string;
  case_id: string;
  author_user_id: string;
  note: string;
  created_at: string;
}

export interface DisciplineCaseResponse {
  id: string;
  tenant_id: string;
  case_id: string;
  response_type: string;
  description: string;
  created_at: string;
  created_by: string;
}

export interface DisciplineGuardianContact {
  id: string;
  tenant_id: string;
  case_id: string;
  recipient_type: string;
  recipient_id: string;
  channel: string | null;
  notification_id: string | null;
  notes: string;
  created_at: string;
  created_by: string;
}

export interface DisciplineAppeal {
  id: string;
  tenant_id: string;
  case_id: string;
  raised_by: string;
  reason: string;
  filed_at: string;
  decision: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_notes: string | null;
}

export interface DisciplineRecognition {
  id: string;
  tenant_id: string;
  student_id: string;
  category: string;
  description: string;
  awarded_by: string;
  awarded_at: string;
}

/** Channels contactGuardian() actually dispatches through CommunicationService
 * — 'phone_call'/'in_person' (or no channel) are logged only. */
const DISPATCH_CHANNELS = ['whatsapp', 'sms', 'email'];

@Injectable()
export class DisciplineService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly communication: CommunicationService,
    private readonly staff: StaffService,
    private readonly guardians: GuardiansService,
  ) {}

  // ---------------------------------------------------------------------
  // Cases (FR-OPS-040: incident recording, investigation, response)
  // ---------------------------------------------------------------------

  async createCase(input: CreateCaseDto): Promise<DisciplineCase> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<DisciplineCase>(
      `insert into discipline_cases
         (tenant_id, student_id, category, severity, incident_date, description, reported_by, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $7)
       returning *`,
      [input.studentId, input.category, input.severity, input.incidentDate, input.description, input.reportedBy, userId],
    );
    return rows[0];
  }

  async findAllCases(): Promise<DisciplineCase[]> {
    return this.db.query<DisciplineCase>(`select * from discipline_cases order by incident_date desc`);
  }

  async findCase(id: string): Promise<DisciplineCase> {
    const rows = await this.db.query<DisciplineCase>(`select * from discipline_cases where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Discipline case ${id} not found`);
    }
    return rows[0];
  }

  async startInvestigation(id: string): Promise<DisciplineCase> {
    const { userId } = TenantContextStore.current();
    const discCase = await this.findCase(id);
    if (discCase.status !== 'reported') {
      throw new ConflictException(`Cannot start investigation on case ${id}: it is '${discCase.status}', not 'reported'`);
    }
    const rows = await this.db.query<DisciplineCase>(
      `update discipline_cases set status = 'investigating', updated_at = now(), updated_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  /** Allowed from 'reported' or 'investigating' — minor incidents may skip
   * a formal investigation step. */
  async issueResponse(id: string, input: IssueResponseDto): Promise<DisciplineCaseResponse> {
    const discCase = await this.findCase(id);
    if (!['reported', 'investigating'].includes(discCase.status)) {
      throw new ConflictException(
        `Cannot issue a response on case ${id}: it is '${discCase.status}', not 'reported'/'investigating'`,
      );
    }
    await this.db.query('BEGIN');
    try {
      const rows = await this.db.query<DisciplineCaseResponse>(
        `insert into discipline_case_responses (tenant_id, case_id, response_type, description, created_by)
         values (current_tenant_id(), $1, $2, $3, $4)
         returning *`,
        [id, input.responseType, input.description, input.issuedBy],
      );
      await this.db.query(
        `update discipline_cases set status = 'response_issued', updated_at = now(), updated_by = $1 where id = $2`,
        [input.issuedBy, id],
      );
      await this.db.query('COMMIT');
      return rows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  async findResponses(caseId: string): Promise<DisciplineCaseResponse[]> {
    return this.db.query<DisciplineCaseResponse>(
      `select * from discipline_case_responses where case_id = $1 order by created_at`,
      [caseId],
    );
  }

  async closeCase(id: string): Promise<DisciplineCase> {
    const { userId } = TenantContextStore.current();
    const discCase = await this.findCase(id);
    if (discCase.status !== 'response_issued') {
      throw new ConflictException(`Cannot close case ${id}: it is '${discCase.status}', not 'response_issued'`);
    }
    const rows = await this.db.query<DisciplineCase>(
      `update discipline_cases set status = 'closed', closed_at = now(), updated_at = now(), updated_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  /** Explicit way back from 'closed' — see class header. */
  async reopenCase(id: string): Promise<DisciplineCase> {
    const { userId } = TenantContextStore.current();
    const discCase = await this.findCase(id);
    if (discCase.status !== 'closed') {
      throw new ConflictException(`Cannot reopen case ${id}: it is '${discCase.status}', not 'closed'`);
    }
    const rows = await this.db.query<DisciplineCase>(
      `update discipline_cases set status = 'investigating', reopened_at = now(), updated_at = now(), updated_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------
  // Notes (FR-OPS-040: follow-up)
  // ---------------------------------------------------------------------

  async addNote(caseId: string, input: AddNoteDto): Promise<DisciplineCaseNote> {
    await this.findCase(caseId);
    const rows = await this.db.query<DisciplineCaseNote>(
      `insert into discipline_case_notes (tenant_id, case_id, author_user_id, note)
       values (current_tenant_id(), $1, $2, $3)
       returning *`,
      [caseId, input.authorUserId, input.note],
    );
    return rows[0];
  }

  async findNotes(caseId: string): Promise<DisciplineCaseNote[]> {
    return this.db.query<DisciplineCaseNote>(
      `select * from discipline_case_notes where case_id = $1 order by created_at`,
      [caseId],
    );
  }

  // ---------------------------------------------------------------------
  // Guardian contact (FR-OPS-040 / FR-COM-050)
  // ---------------------------------------------------------------------

  /** Logs a guardian contact. When `channel` is 'whatsapp'/'sms'/'email',
   * also dispatches a real notification via CommunicationService with
   * sensitivity 'confidential' — send()'s existing rule then restricts
   * the actual delivery to email regardless of the channel requested
   * (see class header); the caller's requested channel is still recorded
   * here for the audit trail even when the delivery itself was forced to
   * email. */
  async contactGuardian(caseId: string, input: ContactGuardianDto): Promise<DisciplineGuardianContact> {
    await this.findCase(caseId);

    // recipient_id has no DB-level FK (it's polymorphic — see
    // 0018_staff_directory.sql's / 0019_guardians.sql's headers); 'staff'
    // and 'guardian' both now have a real directory to validate against.
    // 'student' stays unvalidated — no equivalent lookup need has come up
    // for it yet.
    if (input.recipientType === 'staff' && !(await this.staff.isRealStaffMember(input.recipientId))) {
      throw new NotFoundException(`recipientId ${input.recipientId} is not a real staff member of this tenant`);
    }
    if (input.recipientType === 'guardian' && !(await this.guardians.isRealGuardian(input.recipientId))) {
      throw new NotFoundException(`recipientId ${input.recipientId} is not a real guardian of this tenant`);
    }

    let notificationId: string | null = null;
    if (input.channel && DISPATCH_CHANNELS.includes(input.channel)) {
      const notification = await this.communication.createNotification({
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        recipientEmail: input.recipientEmail,
        subject: 'Discipline case update',
        body: input.notes,
        sensitivityLevel: 'confidential',
      });
      await this.communication.send(notification.id);
      notificationId = notification.id;
    }

    const rows = await this.db.query<DisciplineGuardianContact>(
      `insert into discipline_guardian_contacts
         (tenant_id, case_id, recipient_type, recipient_id, channel, notification_id, notes, created_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [
        caseId,
        input.recipientType,
        input.recipientId,
        input.channel ?? null,
        notificationId,
        input.notes,
        input.contactedBy,
      ],
    );
    return rows[0];
  }

  async findGuardianContacts(caseId: string): Promise<DisciplineGuardianContact[]> {
    return this.db.query<DisciplineGuardianContact>(
      `select * from discipline_guardian_contacts where case_id = $1 order by created_at`,
      [caseId],
    );
  }

  // ---------------------------------------------------------------------
  // Appeals (FR-OPS-040)
  // ---------------------------------------------------------------------

  async fileAppeal(caseId: string, input: FileAppealDto): Promise<DisciplineAppeal> {
    await this.db.query('BEGIN');
    try {
      const caseRows = await this.db.query<DisciplineCase>(
        `select * from discipline_cases where id = $1 for update`,
        [caseId],
      );
      if (caseRows.length === 0) {
        throw new NotFoundException(`Discipline case ${caseId} not found`);
      }
      if (caseRows[0].status !== 'response_issued') {
        throw new ConflictException(
          `Cannot file an appeal on case ${caseId}: it is '${caseRows[0].status}', not 'response_issued'`,
        );
      }

      const rows = await this.db.query<DisciplineAppeal>(
        `insert into discipline_appeals (tenant_id, case_id, raised_by, reason, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4)
         returning *`,
        [caseId, input.raisedBy, input.reason, input.raisedBy],
      );
      await this.db.query(
        `update discipline_cases set status = 'appealed', updated_at = now(), updated_by = $1 where id = $2`,
        [input.raisedBy, caseId],
      );
      await this.db.query('COMMIT');
      return rows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  /** Decides a pending appeal and closes the case either way — 'upheld'
   * means the response was wrong (a corrective discipline_case_responses
   * row can be added separately to record the reversal); 'denied' means
   * the original response stands. Either way the case reaches a decided
   * end state, same as every other terminal decision in this codebase. */
  async decideAppeal(appealId: string, input: DecideAppealDto): Promise<DisciplineAppeal> {
    await this.db.query('BEGIN');
    try {
      const appealRows = await this.db.query<DisciplineAppeal>(
        `select * from discipline_appeals where id = $1 for update`,
        [appealId],
      );
      if (appealRows.length === 0) {
        throw new NotFoundException(`Appeal ${appealId} not found`);
      }
      if (appealRows[0].decision !== 'pending') {
        throw new ConflictException(`Cannot decide appeal ${appealId}: it is already '${appealRows[0].decision}'`);
      }

      const rows = await this.db.query<DisciplineAppeal>(
        `update discipline_appeals
         set decision = $1, decided_by = $2, decided_at = now(), decision_notes = $3, updated_at = now(), updated_by = $2
         where id = $4
         returning *`,
        [input.decision, input.decidedBy, input.decisionNotes ?? null, appealId],
      );
      await this.db.query(
        `update discipline_cases set status = 'closed', closed_at = now(), updated_at = now(), updated_by = $1 where id = $2`,
        [input.decidedBy, rows[0].case_id],
      );
      await this.db.query('COMMIT');
      return rows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  async findAppeals(caseId: string): Promise<DisciplineAppeal[]> {
    return this.db.query<DisciplineAppeal>(`select * from discipline_appeals where case_id = $1 order by filed_at`, [
      caseId,
    ]);
  }

  // ---------------------------------------------------------------------
  // Positive-behaviour recognition (FR-OPS-040) — no workflow
  // ---------------------------------------------------------------------

  async createRecognition(input: CreateRecognitionDto): Promise<DisciplineRecognition> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<DisciplineRecognition>(
      `insert into discipline_recognitions (tenant_id, student_id, category, description, awarded_by, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $5)
       returning *`,
      [input.studentId, input.category, input.description, input.awardedBy, userId],
    );
    return rows[0];
  }

  async findAllRecognitions(): Promise<DisciplineRecognition[]> {
    return this.db.query<DisciplineRecognition>(`select * from discipline_recognitions order by awarded_at desc`);
  }

  async findRecognition(id: string): Promise<DisciplineRecognition> {
    const rows = await this.db.query<DisciplineRecognition>(`select * from discipline_recognitions where id = $1`, [
      id,
    ]);
    if (rows.length === 0) {
      throw new NotFoundException(`Recognition ${id} not found`);
    }
    return rows[0];
  }
}
