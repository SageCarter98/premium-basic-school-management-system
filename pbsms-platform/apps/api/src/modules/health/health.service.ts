/**
 * health.service.ts
 *
 * Implements SRS v2.1 Chapter 28 (FR-OPS-030). See 0014_health.sql's
 * header for the guardian-contact design (a second copy of discipline's
 * pattern) and the deferred role/record-scoping restriction.
 *
 * contactGuardian() is a near-verbatim copy of
 * discipline.service.ts's version, dispatching through
 * CommunicationService with sensitivity 'confidential' — see that file's
 * header for why this reuses the existing FR-COM-050 restriction instead
 * of a second mechanism.
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { CommunicationService } from '../communication/communication.service';
import { StaffService } from '../staff/staff.service';
import { GuardiansService } from '../guardians/guardians.service';
import { UpsertRecordDto } from './dto/upsert-record.dto';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { ContactGuardianDto } from './dto/contact-guardian.dto';
import { LogMedicationDto } from './dto/log-medication.dto';

export interface HealthRecord {
  id: string;
  tenant_id: string;
  student_id: string;
  blood_group: string | null;
  allergies: string | null;
  conditions: string | null;
  notes: string | null;
}

export interface HealthIncident {
  id: string;
  tenant_id: string;
  student_id: string;
  incident_date: string;
  description: string;
  severity: string;
  status: string;
  resolved_at: string | null;
  reopened_at: string | null;
}

export interface HealthIncidentGuardianContact {
  id: string;
  tenant_id: string;
  incident_id: string;
  recipient_type: string;
  recipient_id: string;
  channel: string | null;
  notification_id: string | null;
  notes: string;
  created_at: string;
  created_by: string;
}

export interface MedicationLogEntry {
  id: string;
  tenant_id: string;
  student_id: string;
  medication_name: string;
  dosage: string;
  administered_by: string;
  administered_at: string;
  notes: string | null;
}

const DISPATCH_CHANNELS = ['whatsapp', 'sms', 'email'];

@Injectable()
export class HealthService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly communication: CommunicationService,
    private readonly staff: StaffService,
    private readonly guardians: GuardiansService,
  ) {}

  // ---------------------------------------------------------------------
  // Restricted medical records (FR-OPS-030)
  // ---------------------------------------------------------------------

  async upsertRecord(input: UpsertRecordDto): Promise<HealthRecord> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<HealthRecord>(
      `insert into health_records (tenant_id, student_id, blood_group, allergies, conditions, notes, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $6)
       on conflict (tenant_id, student_id)
       do update set blood_group = $2, allergies = $3, conditions = $4, notes = $5, updated_at = now(), updated_by = $6
       returning *`,
      [input.studentId, input.bloodGroup ?? null, input.allergies ?? null, input.conditions ?? null, input.notes ?? null, userId],
    );
    return rows[0];
  }

  async findRecordByStudent(studentId: string): Promise<HealthRecord | null> {
    const rows = await this.db.query<HealthRecord>(`select * from health_records where student_id = $1`, [
      studentId,
    ]);
    return rows.length === 0 ? null : rows[0];
  }

  // ---------------------------------------------------------------------
  // Incidents
  // ---------------------------------------------------------------------

  async createIncident(input: CreateIncidentDto): Promise<HealthIncident> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<HealthIncident>(
      `insert into health_incidents (tenant_id, student_id, incident_date, description, severity, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $5)
       returning *`,
      [input.studentId, input.incidentDate, input.description, input.severity, userId],
    );
    return rows[0];
  }

  async findAllIncidents(): Promise<HealthIncident[]> {
    return this.db.query<HealthIncident>(`select * from health_incidents order by incident_date desc`);
  }

  async findIncident(id: string): Promise<HealthIncident> {
    const rows = await this.db.query<HealthIncident>(`select * from health_incidents where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Health incident ${id} not found`);
    }
    return rows[0];
  }

  async resolveIncident(id: string): Promise<HealthIncident> {
    const { userId } = TenantContextStore.current();
    const incident = await this.findIncident(id);
    if (incident.status !== 'reported') {
      throw new ConflictException(`Cannot resolve incident ${id}: it is '${incident.status}', not 'reported'`);
    }
    const rows = await this.db.query<HealthIncident>(
      `update health_incidents set status = 'resolved', resolved_at = now(), updated_at = now(), updated_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  /** Explicit way back from 'resolved' — same traced-exit lesson as
   * discipline's reopenCase()/communication's startReport(). */
  async reopenIncident(id: string): Promise<HealthIncident> {
    const { userId } = TenantContextStore.current();
    const incident = await this.findIncident(id);
    if (incident.status !== 'resolved') {
      throw new ConflictException(`Cannot reopen incident ${id}: it is '${incident.status}', not 'resolved'`);
    }
    const rows = await this.db.query<HealthIncident>(
      `update health_incidents set status = 'reported', reopened_at = now(), updated_at = now(), updated_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------
  // Guardian notification for incidents (FR-OPS-030 / FR-COM-050)
  // ---------------------------------------------------------------------

  async contactGuardian(incidentId: string, input: ContactGuardianDto): Promise<HealthIncidentGuardianContact> {
    await this.findIncident(incidentId);

    // Same reasoning as discipline.service.ts's contactGuardian(): the
    // 'phone_call'/'in_person' branch below never calls
    // CommunicationService, so validating only inside
    // createNotification() wouldn't catch a bogus id logged that way —
    // this has to happen here, at the point the row is written.
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
        subject: 'Health incident notification',
        body: input.notes,
        sensitivityLevel: 'confidential',
      });
      await this.communication.send(notification.id);
      notificationId = notification.id;
    }

    const rows = await this.db.query<HealthIncidentGuardianContact>(
      `insert into health_incident_guardian_contacts
         (tenant_id, incident_id, recipient_type, recipient_id, channel, notification_id, notes, created_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [
        incidentId,
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

  async findGuardianContacts(incidentId: string): Promise<HealthIncidentGuardianContact[]> {
    return this.db.query<HealthIncidentGuardianContact>(
      `select * from health_incident_guardian_contacts where incident_id = $1 order by created_at`,
      [incidentId],
    );
  }

  // ---------------------------------------------------------------------
  // Medication administration log (FR-OPS-030) — append-only
  // ---------------------------------------------------------------------

  async logMedication(input: LogMedicationDto): Promise<MedicationLogEntry> {
    const rows = await this.db.query<MedicationLogEntry>(
      `insert into medication_administration_log (tenant_id, student_id, medication_name, dosage, administered_by, notes)
       values (current_tenant_id(), $1, $2, $3, $4, $5)
       returning *`,
      [input.studentId, input.medicationName, input.dosage, input.administeredBy, input.notes ?? null],
    );
    return rows[0];
  }

  async findMedicationLogByStudent(studentId: string): Promise<MedicationLogEntry[]> {
    return this.db.query<MedicationLogEntry>(
      `select * from medication_administration_log where student_id = $1 order by administered_at desc`,
      [studentId],
    );
  }
}
