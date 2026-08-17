/**
 * data-protection.service.ts
 *
 * Implements the tenant-scoped half of SRS v2.1 Chapter 39-40 (Ghana Data
 * Protection Act & GDPR Alignment; Consent, Retention & Data Subject
 * Rights) — Phase F. See 0029_data_protection.sql's header for the full
 * scope map (what's built here vs. deliberately not, and why). The
 * platform-scoped half (breach incidents) is data-breach.service.ts.
 */

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { CommunicationService } from '../communication/communication.service';
import { SetPreferenceDto } from '../communication/dto/set-preference.dto';
import { StaffService } from '../staff/staff.service';
import { CreateDataSubjectRequestDto } from './dto/create-data-subject-request.dto';
import { FulfillRequestDto } from './dto/fulfill-request.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { RecordConsentDto } from './dto/record-consent.dto';

const DSR_SLA_DAYS = 30; // DP-030's literal 30-day response SLA

export interface DataInventoryEntry {
  id: string;
  data_category: string;
  description: string;
  lawful_basis: string;
  sensitivity_classification: string;
  source_tables: string[];
}

export interface RetentionPolicy {
  id: string;
  record_type: string;
  retention_description: string;
  retention_years: string | null;
  basis: string;
}

export interface DataSubjectRequest {
  id: string;
  tenant_id: string;
  request_type: string;
  subject_type: string;
  subject_id: string;
  requester_name: string;
  requester_contact: string | null;
  assigned_to: string | null;
  status: string;
  due_date: string;
  fulfilled_at: string | null;
  fulfillment_notes: string | null;
  rejection_reason: string | null;
}

export interface ConsentRecord {
  id: string;
  tenant_id: string;
  subject_type: string;
  subject_id: string;
  consent_type: string;
  channel: string | null;
  granted: boolean;
  version: number;
  recorded_at: string;
  withdrawn_at: string | null;
}

export interface RetentionEligibilityRow {
  recordType: string;
  eligibleCount: number;
  oldestDate: string | null;
}

@Injectable()
export class DataProtectionService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly communication: CommunicationService,
    private readonly staff: StaffService,
  ) {}

  // --------------------------------------------------------------------
  // Reference data (DP-020, 40.2) — read-only, curated centrally.
  // --------------------------------------------------------------------

  async findDataInventory(): Promise<DataInventoryEntry[]> {
    return this.db.query<DataInventoryEntry>(`select * from data_inventory order by data_category`);
  }

  async findRetentionPolicies(): Promise<RetentionPolicy[]> {
    return this.db.query<RetentionPolicy>(`select * from retention_policies order by record_type`);
  }

  /** SAFE, read-only eligibility report — see 0029_data_protection.sql's
   * header for why this pass builds reporting only, never an automated
   * purge. Only the two policies cleanly computable from this schema's
   * actual columns today: attendance (post-graduation) and financial
   * transactions (age-based). Discipline/medical retention keys off
   * "duration of enrolment + N years," which needs an enrolment EXIT date
   * this schema doesn't track per-student (enrolments.end_date exists but
   * isn't reliably populated outside the transfer/closure flows) —
   * flagged, not silently approximated with a guess. */
  async retentionEligibilityReport(): Promise<RetentionEligibilityRow[]> {
    const attendanceRows = await this.db.query<{ count: string; oldest: string | null }>(
      `select count(*) as count, min(ar.attendance_date) as oldest
       from attendance_records ar
       join students s on s.id = ar.student_id
       where s.status = 'graduated' and ar.attendance_date < (current_date - interval '7 years')`,
    );
    const financialRows = await this.db.query<{ count: string; oldest: string | null }>(
      `select count(*) as count, min(i.issued_at) as oldest
       from invoices i
       where i.issued_at < (now() - interval '7 years')`,
    );
    return [
      { recordType: 'attendance_record', eligibleCount: Number(attendanceRows[0].count), oldestDate: attendanceRows[0].oldest },
      { recordType: 'financial_transaction', eligibleCount: Number(financialRows[0].count), oldestDate: financialRows[0].oldest },
    ];
  }

  // --------------------------------------------------------------------
  // Data subject requests (DP-030/DP-090)
  // --------------------------------------------------------------------

  async createRequest(input: CreateDataSubjectRequestDto): Promise<DataSubjectRequest> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<DataSubjectRequest>(
      `insert into data_subject_requests
         (tenant_id, request_type, subject_type, subject_id, requester_name, requester_contact, due_date, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, now() + interval '${DSR_SLA_DAYS} days', $6, $6)
       returning *`,
      [input.requestType, input.subjectType, input.subjectId, input.requesterName, input.requesterContact ?? null, userId],
    );
    return rows[0];
  }

  async findAllRequests(status?: string): Promise<DataSubjectRequest[]> {
    return this.db.query<DataSubjectRequest>(
      `select * from data_subject_requests where $1::text is null or status = $1 order by due_date asc`,
      [status ?? null],
    );
  }

  /** DP-030's 30-day SLA is meaningless without a way to see a breach —
   * `due_date` was being stored but never surfaced anywhere. Real
   * automated escalation (Chapter 26's Action Tracker/Escalation Engine)
   * is a separate, larger integration not attempted here; this is the
   * same "safe, read-only reporting" scope as retentionEligibilityReport(). */
  async findOverdueRequests(): Promise<DataSubjectRequest[]> {
    return this.db.query<DataSubjectRequest>(
      `select * from data_subject_requests where status in ('received', 'in_progress') and due_date < now() order by due_date asc`,
    );
  }

  async findOneRequest(id: string): Promise<DataSubjectRequest> {
    const rows = await this.db.query<DataSubjectRequest>(`select * from data_subject_requests where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Data subject request ${id} not found`);
    }
    return rows[0];
  }

  async assignRequest(id: string, assigneeUserId: string): Promise<DataSubjectRequest> {
    const { userId } = TenantContextStore.current();
    const request = await this.findOneRequest(id);
    if (request.status !== 'received' && request.status !== 'in_progress') {
      throw new ConflictException(`Request ${id} is '${request.status}' — cannot reassign a fulfilled/rejected request`);
    }
    if (!(await this.staff.isRealStaffMember(assigneeUserId))) {
      throw new NotFoundException(`assigneeUserId ${assigneeUserId} is not a real staff member of this tenant`);
    }
    const rows = await this.db.query<DataSubjectRequest>(
      `update data_subject_requests set assigned_to = $2, status = 'in_progress', updated_at = now(), updated_by = $3
       where id = $1 returning *`,
      [id, assigneeUserId, userId],
    );
    return rows[0];
  }

  async fulfillRequest(id: string, input: FulfillRequestDto): Promise<DataSubjectRequest> {
    const { userId } = TenantContextStore.current();
    const request = await this.findOneRequest(id);
    if (request.status === 'fulfilled' || request.status === 'rejected') {
      throw new ConflictException(`Request ${id} is already '${request.status}'`);
    }
    const rows = await this.db.query<DataSubjectRequest>(
      `update data_subject_requests
       set status = 'fulfilled', fulfilled_at = now(), fulfillment_notes = $2, updated_at = now(), updated_by = $3
       where id = $1 returning *`,
      [id, input.fulfillmentNotes, userId],
    );
    return rows[0];
  }

  async rejectRequest(id: string, input: RejectRequestDto): Promise<DataSubjectRequest> {
    const { userId } = TenantContextStore.current();
    const request = await this.findOneRequest(id);
    if (request.status === 'fulfilled' || request.status === 'rejected') {
      throw new ConflictException(`Request ${id} is already '${request.status}'`);
    }
    const rows = await this.db.query<DataSubjectRequest>(
      `update data_subject_requests
       set status = 'rejected', rejection_reason = $2, updated_at = now(), updated_by = $3
       where id = $1 returning *`,
      [id, input.rejectionReason, userId],
    );
    return rows[0];
  }

  // --------------------------------------------------------------------
  // Consent (DP-070/DP-080)
  // --------------------------------------------------------------------

  /** Records a new versioned consent event and, for 'communication_channel'
   * consent, ALSO drives CommunicationService.setPreference() so send()'s
   * existing opt-in gate (which reads communication_preferences, not this
   * table) reflects the change immediately — this table is the audited,
   * versioned front door; communication_preferences stays the fast-path
   * lookup it already was, unchanged. */
  async recordConsent(input: RecordConsentDto): Promise<ConsentRecord> {
    const { userId } = TenantContextStore.current();
    if (input.consentType === 'communication_channel' && !input.channel) {
      throw new BadRequestException("channel is required when consentType is 'communication_channel'");
    }
    if (input.consentType === 'biometric' && input.channel) {
      throw new BadRequestException("channel must be omitted when consentType is 'biometric'");
    }

    const priorVersionRows = await this.db.query<{ version: number }>(
      `select version from consent_records
       where subject_type = $1 and subject_id = $2 and consent_type = $3
         and coalesce(channel, '') = coalesce($4, '')
       order by version desc limit 1`,
      [input.subjectType, input.subjectId, input.consentType, input.channel ?? null],
    );
    const nextVersion = (priorVersionRows[0]?.version ?? 0) + 1;

    const rows = await this.db.query<ConsentRecord>(
      `insert into consent_records
         (tenant_id, subject_type, subject_id, consent_type, channel, granted, version, withdrawn_at, recorded_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [
        input.subjectType,
        input.subjectId,
        input.consentType,
        input.channel ?? null,
        input.granted,
        nextVersion,
        input.granted ? null : new Date().toISOString(),
        userId,
      ],
    );

    if (input.consentType === 'communication_channel' && input.channel) {
      const preference = new SetPreferenceDto();
      preference.recipientType = input.subjectType;
      preference.recipientId = input.subjectId;
      preference.channel = input.channel;
      preference.optedIn = input.granted;
      await this.communication.setPreference(preference);
    }

    return rows[0];
  }

  async findCurrentConsent(subjectType: string, subjectId: string): Promise<ConsentRecord[]> {
    return this.db.query<ConsentRecord>(
      `select distinct on (consent_type, coalesce(channel, '')) *
       from consent_records
       where subject_type = $1 and subject_id = $2
       order by consent_type, coalesce(channel, ''), version desc`,
      [subjectType, subjectId],
    );
  }

  async findConsentHistory(subjectType: string, subjectId: string): Promise<ConsentRecord[]> {
    return this.db.query<ConsentRecord>(
      `select * from consent_records where subject_type = $1 and subject_id = $2 order by version desc`,
      [subjectType, subjectId],
    );
  }
}
