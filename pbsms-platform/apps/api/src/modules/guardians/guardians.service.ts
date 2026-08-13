/**
 * guardians.service.ts — the real guardian directory and the FR-STU-020
 * student<->guardian link (SRS v2.1 Chapter 16.2). Modeled on
 * staff.service.ts's shape: a lookup other modules can validate a
 * polymorphic recipient_id against (isRealGuardian(), mirroring
 * isRealStaffMember() exactly — see 0019_guardians.sql's header for why
 * this can't be a DB-level FK on communication/discipline/health's
 * recipient_id columns), plus the CRUD staff.service.ts didn't need
 * (guardians are a genuinely new entity here, unlike staff which reuses
 * existing users/tenant_users rows).
 *
 * Existence checks against students go straight to the students table via
 * this module's own TenantDatabaseService connection rather than
 * importing StudentsModule — the same pattern admissions/documents
 * already use for the same reason (RLS scopes the connection, not the
 * module; a plain read like this isn't the kind of real cross-module
 * behavior discipline's contactGuardian()->CommunicationService call is).
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';

export interface Guardian {
  id: string;
  tenant_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
}

export interface StudentGuardianLink {
  id: string;
  tenant_id: string;
  student_id: string;
  guardian_id: string;
  relationship: string | null;
  is_primary_contact: boolean;
  is_emergency_contact: boolean;
  can_pickup: boolean;
  has_finance_access: boolean;
  has_report_access: boolean;
}

@Injectable()
export class GuardiansService {
  constructor(private readonly db: TenantDatabaseService) {}

  async create(input: { fullName: string; phone?: string; email?: string }): Promise<Guardian> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<Guardian>(
      `insert into guardians (tenant_id, full_name, phone, email, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $4)
       returning *`,
      [input.fullName, input.phone ?? null, input.email ?? null, userId],
    );
    return rows[0];
  }

  async findAll(): Promise<Guardian[]> {
    return this.db.query<Guardian>(`select * from guardians order by full_name`);
  }

  async findOne(id: string): Promise<Guardian> {
    const rows = await this.db.query<Guardian>(`select * from guardians where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Guardian ${id} not found`);
    }
    return rows[0];
  }

  /** For other services validating a polymorphic recipientType/
   * issuedToType === 'guardian' id against the real directory instead of
   * accepting any UUID blindly — same role isRealStaffMember() plays for
   * 'staff'. */
  async isRealGuardian(id: string): Promise<boolean> {
    const rows = await this.db.query<{ hit: number }>(`select 1 as hit from guardians where id = $1 limit 1`, [id]);
    return rows.length > 0;
  }

  async findForStudent(studentId: string): Promise<(StudentGuardianLink & Pick<Guardian, 'full_name' | 'phone' | 'email'>)[]> {
    await this.assertStudentExists(studentId);
    return this.db.query(
      `select sg.*, g.full_name, g.phone, g.email
       from student_guardians sg
       join guardians g on g.id = sg.guardian_id
       where sg.student_id = $1
       order by sg.is_primary_contact desc, g.full_name`,
      [studentId],
    );
  }

  async linkToStudent(studentId: string, input: {
    guardianId: string;
    relationship?: string;
    isPrimaryContact?: boolean;
    isEmergencyContact?: boolean;
    canPickup?: boolean;
    hasFinanceAccess?: boolean;
    hasReportAccess?: boolean;
  }): Promise<StudentGuardianLink> {
    await this.assertStudentExists(studentId);
    await this.findOne(input.guardianId); // 404s if not a real guardian in this tenant

    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<StudentGuardianLink>(
      `insert into student_guardians
         (tenant_id, student_id, guardian_id, relationship, is_primary_contact,
          is_emergency_contact, can_pickup, has_finance_access, has_report_access,
          created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       returning *`,
      [
        studentId,
        input.guardianId,
        input.relationship ?? null,
        input.isPrimaryContact ?? false,
        input.isEmergencyContact ?? false,
        input.canPickup ?? false,
        input.hasFinanceAccess ?? false,
        input.hasReportAccess ?? false,
        userId,
      ],
    );
    return rows[0];
  }

  async updateLink(linkId: string, input: {
    relationship?: string;
    isPrimaryContact?: boolean;
    isEmergencyContact?: boolean;
    canPickup?: boolean;
    hasFinanceAccess?: boolean;
    hasReportAccess?: boolean;
  }): Promise<StudentGuardianLink> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<StudentGuardianLink>(
      `update student_guardians set
         relationship = coalesce($2, relationship),
         is_primary_contact = coalesce($3, is_primary_contact),
         is_emergency_contact = coalesce($4, is_emergency_contact),
         can_pickup = coalesce($5, can_pickup),
         has_finance_access = coalesce($6, has_finance_access),
         has_report_access = coalesce($7, has_report_access),
         updated_at = now(),
         updated_by = $8
       where id = $1
       returning *`,
      [
        linkId,
        input.relationship ?? null,
        input.isPrimaryContact ?? null,
        input.isEmergencyContact ?? null,
        input.canPickup ?? null,
        input.hasFinanceAccess ?? null,
        input.hasReportAccess ?? null,
        userId,
      ],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Guardian link ${linkId} not found`);
    }
    return rows[0];
  }

  async unlink(linkId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(`delete from student_guardians where id = $1 returning id`, [
      linkId,
    ]);
    if (rows.length === 0) {
      throw new NotFoundException(`Guardian link ${linkId} not found`);
    }
  }

  private async assertStudentExists(studentId: string): Promise<void> {
    const rows = await this.db.query<{ hit: number }>(
      `select 1 as hit from students where id = $1 and deleted_at is null limit 1`,
      [studentId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Student ${studentId} not found`);
    }
  }
}
