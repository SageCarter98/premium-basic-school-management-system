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

import { randomBytes, createHash } from 'node:crypto';
import { ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL, TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { SubmitGuardianAccessRequestDto } from './dto/submit-guardian-access-request.dto';
import { ApproveGuardianAccessRequestDto } from './dto/review-guardian-access-request.dto';

export interface Guardian {
  id: string;
  tenant_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
}

export interface GuardianAccessGrant {
  id: string;
  tenant_id: string;
  guardian_id: string;
  created_at: string;
  created_by: string | null;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
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

export interface GuardianAccessRequest {
  id: string;
  tenant_id: string;
  student_id: string;
  requester_name: string;
  requester_phone: string | null;
  requester_email: string | null;
  relationship: string | null;
  message: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

const ACCESS_REQUEST_RATE_LIMIT_WINDOW_MINUTES = 60;
const ACCESS_REQUEST_RATE_LIMIT_MAX_ATTEMPTS = 5;

@Injectable()
export class GuardiansService {
  // pool is optional because jobs-worker's handlers construct this class
  // by hand (new GuardiansService(workerConn) — no Nest DI, see
  // worker-tenant-connection.ts's header) for methods that never need it;
  // only submitAccessRequest() below actually requires it, and that
  // method is HTTP-only (a public unauthenticated route), never called
  // from a background job.
  constructor(
    private readonly db: TenantDatabaseService,
    @Inject(PG_POOL) private readonly pool?: Pool,
  ) {}

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

  /**
   * Stage 6 (Parent View, spec §6.3/§8.6): mints a link a staff member
   * shares with a guardian directly (WhatsApp, email, printed — this
   * deliberately does NOT wire into communication.service.ts's automated
   * sends; that integration is a separate, larger scope, confirmed with
   * the user before building this). The raw token is returned to the
   * caller exactly once — only its sha256 hash is ever persisted, same
   * "never store the literal secret" rule refresh_tokens/
   * password_reset_tokens already follow (0025_auth_completeness.sql).
   */
  async createAccessGrant(
    guardianId: string,
    expiresInDays = 90,
  ): Promise<{ grant: GuardianAccessGrant; token: string }> {
    await this.findOne(guardianId); // 404s if not a real guardian in this tenant
    const { userId } = TenantContextStore.current();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const rows = await this.db.query<GuardianAccessGrant>(
      `insert into guardian_access_grants (tenant_id, guardian_id, token_hash, expires_at, created_by)
       values (current_tenant_id(), $1, $2, $3, $4)
       returning id, tenant_id, guardian_id, created_at, created_by, expires_at, revoked_at, last_used_at`,
      [guardianId, tokenHash, expiresAt, userId],
    );
    return { grant: rows[0], token };
  }

  async listAccessGrants(guardianId: string): Promise<GuardianAccessGrant[]> {
    return this.db.query<GuardianAccessGrant>(
      `select id, tenant_id, guardian_id, created_at, created_by, expires_at, revoked_at, last_used_at
       from guardian_access_grants where guardian_id = $1 order by created_at desc`,
      [guardianId],
    );
  }

  async revokeAccessGrant(grantId: string): Promise<GuardianAccessGrant> {
    const rows = await this.db.query<GuardianAccessGrant>(
      `update guardian_access_grants set revoked_at = now()
       where id = $1 and revoked_at is null
       returning id, tenant_id, guardian_id, created_at, created_by, expires_at, revoked_at, last_used_at`,
      [grantId],
    );
    if (rows.length === 0) {
      throw new ConflictException(`Grant ${grantId} not found or already revoked`);
    }
    return rows[0];
  }

  /** The one public, unauthenticated write in this module — no
   * TenantContextStore, no RLS, same "raw pool, no tenant known yet"
   * posture documents.service.ts's verify() already established for the
   * identical problem. Rate-limited by school_code+admission_no (see
   * 0043_guardian_access_requests.sql's header for why not by token —
   * there's no secret here to hash) rather than the specific outcome, so
   * hammering either a real or a made-up admission number is throttled
   * the same way. */
  async submitAccessRequest(input: SubmitGuardianAccessRequestDto): Promise<void> {
    if (!this.pool) {
      throw new Error('GuardiansService.submitAccessRequest() requires a PG_POOL — not available in this context');
    }
    const client = await this.pool.connect();
    try {
      const { rows: attemptRows } = await client.query<{ n: string }>(
        `select count(*)::int as n from guardian_access_request_attempts
         where school_code = $1 and admission_no = $2
           and attempted_at > now() - interval '${ACCESS_REQUEST_RATE_LIMIT_WINDOW_MINUTES} minutes'`,
        [input.schoolCode, input.admissionNo],
      );
      if (Number(attemptRows[0].n) >= ACCESS_REQUEST_RATE_LIMIT_MAX_ATTEMPTS) {
        throw new HttpException(
          `Too many requests for this school/admission number. Try again after ${ACCESS_REQUEST_RATE_LIMIT_WINDOW_MINUTES} minutes.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await client.query(`insert into guardian_access_request_attempts (school_code, admission_no) values ($1, $2)`, [
        input.schoolCode,
        input.admissionNo,
      ]);

      const { rows } = await client.query(`select * from submit_guardian_access_request($1, $2, $3, $4, $5, $6, $7)`, [
        input.schoolCode,
        input.admissionNo,
        input.requesterName,
        input.requesterPhone ?? null,
        input.requesterEmail ?? null,
        input.relationship ?? null,
        input.message ?? null,
      ]);
      if (rows.length === 0) {
        // Deliberately the same NotFoundException shape regardless of
        // whether the school code or the admission number was wrong —
        // see the migration header on why this can't be more specific.
        throw new NotFoundException(
          'Could not find a matching student — check the school code and admission number.',
        );
      }
    } finally {
      client.release();
    }
  }

  /** Staff-side review queue — ordinary tenant-scoped read, unlike
   * submitAccessRequest() above. */
  async findAllAccessRequests(status?: string): Promise<GuardianAccessRequest[]> {
    if (status) {
      return this.db.query<GuardianAccessRequest>(
        `select * from guardian_access_requests where status = $1 order by created_at desc`,
        [status],
      );
    }
    return this.db.query<GuardianAccessRequest>(`select * from guardian_access_requests order by created_at desc`);
  }

  private async findAccessRequest(id: string): Promise<GuardianAccessRequest> {
    const rows = await this.db.query<GuardianAccessRequest>(`select * from guardian_access_requests where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Guardian access request ${id} not found`);
    }
    return rows[0];
  }

  /** Approval is the one action that actually DOES something beyond
   * flipping a status column — it creates the real guardian record this
   * request was only ever a claim about, links it to the student, and
   * mints a real access grant, reusing create()/linkToStudent()/
   * createAccessGrant() rather than re-deriving any of their logic.
   * Deliberately always creates a NEW guardian rather than trying to
   * match an existing one — same "flag, don't silently merge" restraint
   * admissions.service.ts's possible_duplicate_of already applies; a
   * staff member who recognizes this is actually an existing guardian can
   * still unlink/relink by hand afterward from the Guardians tab. */
  async approveAccessRequest(
    id: string,
    input: ApproveGuardianAccessRequestDto,
  ): Promise<{ request: GuardianAccessRequest; guardian: Guardian; link: StudentGuardianLink; token: string }> {
    const request = await this.findAccessRequest(id);
    if (request.status !== 'pending') {
      throw new ConflictException(`Guardian access request ${id} is '${request.status}', not 'pending'`);
    }
    const { userId } = TenantContextStore.current();

    const guardian = await this.create({
      fullName: request.requester_name,
      phone: request.requester_phone ?? undefined,
      email: request.requester_email ?? undefined,
    });
    const link = await this.linkToStudent(request.student_id, {
      guardianId: guardian.id,
      relationship: request.relationship ?? undefined,
      isPrimaryContact: input.isPrimaryContact,
      isEmergencyContact: input.isEmergencyContact,
      canPickup: input.canPickup,
      hasFinanceAccess: input.hasFinanceAccess,
      hasReportAccess: input.hasReportAccess ?? true, // the whole point of the request — default it on
    });
    const { token } = await this.createAccessGrant(guardian.id);

    const rows = await this.db.query<GuardianAccessRequest>(
      `update guardian_access_requests set status = 'approved', reviewed_by = $1, reviewed_at = now(), updated_at = now()
       where id = $2
       returning *`,
      [userId, id],
    );
    return { request: rows[0], guardian, link, token };
  }

  async rejectAccessRequest(id: string, reviewNotes?: string): Promise<GuardianAccessRequest> {
    const request = await this.findAccessRequest(id);
    if (request.status !== 'pending') {
      throw new ConflictException(`Guardian access request ${id} is '${request.status}', not 'pending'`);
    }
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<GuardianAccessRequest>(
      `update guardian_access_requests set status = 'rejected', reviewed_by = $1, reviewed_at = now(), review_notes = $2, updated_at = now()
       where id = $3
       returning *`,
      [userId, reviewNotes ?? null, id],
    );
    return rows[0];
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
