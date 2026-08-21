/**
 * documents.service.ts
 *
 * Implements SRS v2.1 Chapter 22.1 (Document Engine, FR-DOC-010..030).
 * Reads student_results/student_result_items (report cards, transcripts),
 * applicants (admission letters) and promotion_decisions (completion
 * certificates) but never writes to any of them — see
 * 0007_promotion_documents.sql's header for the "snapshot, never a live
 * join" reasoning `content` follows.
 *
 * verify() is the one method here that deliberately does NOT go through
 * TenantDatabaseService — it has no tenant context to scope by, which is
 * the entire point (FR-DOC-020: a third party verifies "without
 * contacting the school"). It injects PG_POOL directly and calls
 * verify_document(), the exact same shape auth.module.ts's login() uses
 * for login_lookup() and for the identical reason — see that file's
 * header comment.
 *
 * generateReportCard() now also composes NaccaService.competencyProfile()
 * per subject item — the same server-side composition
 * parent-view.service.ts's getReportCard() already established (that
 * function's own header explains why: no adoption gate needed,
 * competencyProfile()'s join naturally returns [] for a tenant that
 * hasn't opted into NaCCA). This DOES change the existing, tested
 * generateReportCard() path (unlike Parent View's read-only composition),
 * but it's additive-only — an empty/omitted competencyProfile array for
 * every non-adopting tenant, identical output to before this change.
 *
 * Every generate*() method and findOne() also now return a qrCodeDataUri
 * — a QR-encoded verify URL, generated on read from the existing
 * verification_token rather than stored (cheap to regenerate, avoids a
 * schema migration). See this module's own scope note: PDF rendering
 * itself stays out of scope (browser @media print, already built for
 * Parent View's report card, is the print path) — this only adds the
 * scannable link a printed copy needs to be independently verifiable.
 */

import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import * as QRCode from 'qrcode';
import { PG_POOL, TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { NaccaService } from '../nacca/nacca.service';
import { UpsertBrandingDto } from './dto/upsert-branding.dto';
import { GenerateReportCardDto } from './dto/generate-report-card.dto';
import { GenerateTranscriptDto } from './dto/generate-transcript.dto';
import { GenerateAdmissionLetterDto } from './dto/generate-admission-letter.dto';
import { GenerateCompletionCertificateDto } from './dto/generate-completion-certificate.dto';
import { GenerateReceiptDto } from './dto/generate-receipt.dto';
import { RevokeDocumentDto } from './dto/revoke-document.dto';

// Same "read from env, documented fallback for local dev" pattern
// auth.module.ts's JWT_SECRET uses. Points at apps/web's dev server —
// the /verify page there resolves the token via the existing public
// GET /v1/documents/verify route, nothing new to build there.
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL ?? 'http://localhost:3001';

export interface TenantBranding {
  id: string;
  tenant_id: string;
  school_name_override: string | null;
  signatory_name: string | null;
  signatory_title: string | null;
}

export interface GeneratedDocument {
  id: string;
  tenant_id: string;
  document_type: string;
  reference_number: string;
  verification_token: string;
  applicant_id: string | null;
  student_result_id: string | null;
  student_id: string | null;
  promotion_decision_id: string | null;
  payment_id: string | null;
  content: unknown;
  generated_at: string;
  generated_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

export interface VerificationResult {
  valid: boolean;
  documentType?: string;
  referenceNumber?: string;
  tenantName?: string;
  generatedAt?: string;
  revoked?: boolean;
}

const REFERENCE_PREFIXES: Record<string, string> = {
  report_card: 'RC',
  transcript: 'TR',
  admission_letter: 'AL',
  completion_certificate: 'CC',
  receipt: 'RCT',
};

const APPROVED_RESULT_STATUSES = ['published', 'locked', 'archived'];

// FR-DOC-020 rate limiting — looser than auth.module.ts's login threshold
// (this isn't a credential-guessing surface, but the token space still
// shouldn't be brute-forceable unbounded) — see 0037's own header.
const VERIFY_RATE_LIMIT_WINDOW_MINUTES = 15;
const VERIFY_RATE_LIMIT_MAX_ATTEMPTS = 20;

function hashVerifyToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: TenantDatabaseService,
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly nacca: NaccaService,
  ) {}

  private buildVerifyUrl(verificationToken: string): string {
    return `${PUBLIC_APP_URL}/verify?token=${verificationToken}`;
  }

  private async withQrCode<T extends { verification_token: string }>(doc: T): Promise<T & { qrCodeDataUri: string }> {
    const qrCodeDataUri = await QRCode.toDataURL(this.buildVerifyUrl(doc.verification_token));
    return { ...doc, qrCodeDataUri };
  }

  async getBranding(): Promise<TenantBranding | null> {
    const rows = await this.db.query<TenantBranding>(`select * from tenant_branding limit 1`);
    return rows[0] ?? null;
  }

  async upsertBranding(input: UpsertBrandingDto): Promise<TenantBranding> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<TenantBranding>(
      `insert into tenant_branding (tenant_id, school_name_override, signatory_name, signatory_title, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $4)
       on conflict (tenant_id)
       do update set school_name_override = $1, signatory_name = $2, signatory_title = $3, updated_by = $4, updated_at = now()
       returning *`,
      [input.schoolNameOverride ?? null, input.signatoryName ?? null, input.signatoryTitle ?? null, userId],
    );
    return rows[0];
  }

  async findAll(): Promise<GeneratedDocument[]> {
    return this.db.query<GeneratedDocument>(`select * from generated_documents order by generated_at desc`);
  }

  async findOne(id: string): Promise<GeneratedDocument & { qrCodeDataUri: string }> {
    const rows = await this.db.query<GeneratedDocument>(`select * from generated_documents where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return this.withQrCode(rows[0]);
  }

  async revoke(id: string, input: RevokeDocumentDto): Promise<GeneratedDocument> {
    const { userId } = TenantContextStore.current();
    const doc = await this.findOne(id);
    if (doc.revoked_at) {
      throw new ConflictException(`Document ${id} is already revoked`);
    }
    const rows = await this.db.query<GeneratedDocument>(
      `update generated_documents set revoked_at = now(), revoked_by = $1, revoke_reason = $2 where id = $3 returning *`,
      [userId, input.reason, id],
    );
    return rows[0];
  }

  /** FR-DOC-020, with no tenant context — see class header comment. */
  async verify(token: string): Promise<VerificationResult> {
    const client = await this.pool.connect();
    try {
      const tokenHash = hashVerifyToken(token);
      const { rows: attemptRows } = await client.query<{ n: string }>(
        `select count(*)::int as n from document_verify_attempts
         where token_hash = $1 and attempted_at > now() - interval '${VERIFY_RATE_LIMIT_WINDOW_MINUTES} minutes'`,
        [tokenHash],
      );
      if (Number(attemptRows[0].n) >= VERIFY_RATE_LIMIT_MAX_ATTEMPTS) {
        throw new HttpException(
          `Too many verification attempts for this document. Try again after ${VERIFY_RATE_LIMIT_WINDOW_MINUTES} minutes.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await client.query(`insert into document_verify_attempts (token_hash) values ($1)`, [tokenHash]);

      const { rows } = await client.query(`select * from verify_document($1)`, [token]);
      if (rows.length === 0) {
        return { valid: false };
      }
      const row = rows[0];
      return {
        valid: true,
        documentType: row.document_type,
        referenceNumber: row.reference_number,
        tenantName: row.tenant_name,
        generatedAt: row.generated_at,
        revoked: row.revoked_at !== null,
      };
    } finally {
      client.release();
    }
  }

  async generateReportCard(input: GenerateReportCardDto): Promise<GeneratedDocument & { qrCodeDataUri: string }> {
    const { userId } = TenantContextStore.current();

    const resultRows = await this.db.query<{
      id: string;
      version: number;
      class_id: string;
      academic_year_id: string;
      status: string;
      average_percentage: string | null;
      subjects_failed_count: number;
      overall_pass: boolean | null;
      student_id: string;
    }>(`select * from student_results where id = $1`, [input.studentResultId]);
    if (resultRows.length === 0) {
      throw new NotFoundException(`Student result ${input.studentResultId} not found`);
    }
    const result = resultRows[0];
    if (!APPROVED_RESULT_STATUSES.includes(result.status)) {
      throw new ConflictException(
        `Cannot generate a report card from result ${result.id}: it is '${result.status}', not published/locked/archived (FR-DOC-010)`,
      );
    }

    const items = await this.db.query<{
      subject_id: string;
      subject_name: string;
      percentage: string;
      grade: string;
      point: string | null;
      remark: string | null;
      is_pass: boolean;
    }>(
      `select subject_id, subject_name, percentage, grade, point, remark, is_pass from student_result_items where student_result_id = $1 order by subject_name`,
      [result.id],
    );

    const [student, klass, year, branding] = await Promise.all([
      this.db.query<{ first_name: string; last_name: string; admission_no: string }>(
        `select first_name, last_name, admission_no from students where id = $1`,
        [result.student_id],
      ),
      this.db.query<{ name: string; level: string }>(`select name, level from classes where id = $1`, [
        result.class_id,
      ]),
      this.db.query<{ name: string }>(`select name from academic_years where id = $1`, [result.academic_year_id]),
      this.getBranding(),
    ]);

    // DOM-030: same server-side composition parent-view.service.ts's
    // getReportCard() already established — competencyProfile() needs no
    // adoption-gate check itself, an empty array is the natural "tenant
    // hasn't opted into NaCCA / no indicators configured for this
    // subject" case. Attached per-item so a non-adopting tenant's report
    // card content is byte-for-byte identical to before this change.
    const profiles = await Promise.all(
      items.map((item) => this.nacca.competencyProfile(result.student_id, item.subject_id, result.academic_year_id)),
    );
    const itemsWithCompetency = items.map((item, i) => ({
      ...item,
      competencyProfile: profiles[i].length > 0 ? profiles[i] : undefined,
    }));

    const content = {
      student: { id: result.student_id, ...student[0] },
      class: { id: result.class_id, ...klass[0] },
      academicYear: { id: result.academic_year_id, ...year[0] },
      resultVersion: result.version,
      items: itemsWithCompetency,
      averagePercentage: result.average_percentage,
      subjectsFailedCount: result.subjects_failed_count,
      overallPass: result.overall_pass,
      branding,
    };

    const doc = await this.insertDocument('report_card', content, { studentResultId: result.id }, userId);
    return this.withQrCode(doc);
  }

  /** Spans every currently-current approved result the student has across
   * academic years — not one version, unlike a report card. */
  async generateTranscript(input: GenerateTranscriptDto): Promise<GeneratedDocument & { qrCodeDataUri: string }> {
    const { userId } = TenantContextStore.current();

    const studentRows = await this.db.query<{ first_name: string; last_name: string; admission_no: string }>(
      `select first_name, last_name, admission_no from students where id = $1`,
      [input.studentId],
    );
    if (studentRows.length === 0) {
      throw new NotFoundException(`Student ${input.studentId} not found`);
    }

    const results = await this.db.query<{
      id: string;
      version: number;
      class_id: string;
      academic_year_id: string;
      average_percentage: string | null;
      overall_pass: boolean | null;
    }>(
      `select id, version, class_id, academic_year_id, average_percentage, overall_pass
       from student_results
       where student_id = $1 and status = any($2::text[]) and superseded_at is null
       order by academic_year_id`,
      [input.studentId, APPROVED_RESULT_STATUSES],
    );
    if (results.length === 0) {
      throw new ConflictException(
        `Cannot generate a transcript for student ${input.studentId}: no approved results found`,
      );
    }

    const years = [];
    for (const result of results) {
      const [klass, year, items] = await Promise.all([
        this.db.query<{ name: string; level: string }>(`select name, level from classes where id = $1`, [
          result.class_id,
        ]),
        this.db.query<{ name: string }>(`select name from academic_years where id = $1`, [
          result.academic_year_id,
        ]),
        this.db.query<{ subject_name: string; percentage: string; grade: string }>(
          `select subject_name, percentage, grade from student_result_items where student_result_id = $1 order by subject_name`,
          [result.id],
        ),
      ]);
      years.push({
        academicYear: { id: result.academic_year_id, ...year[0] },
        class: { id: result.class_id, ...klass[0] },
        resultVersion: result.version,
        averagePercentage: result.average_percentage,
        overallPass: result.overall_pass,
        items,
      });
    }

    const branding = await this.getBranding();
    const content = { student: { id: input.studentId, ...studentRows[0] }, years, branding };

    const doc = await this.insertDocument('transcript', content, { studentId: input.studentId }, userId);
    return this.withQrCode(doc);
  }

  async generateAdmissionLetter(input: GenerateAdmissionLetterDto): Promise<GeneratedDocument & { qrCodeDataUri: string }> {
    const { userId } = TenantContextStore.current();

    const applicantRows = await this.db.query<{
      first_name: string;
      last_name: string;
      dob: string | null;
      gender: string | null;
      status: string;
      admission_no: string | null;
      student_id: string | null;
      school_id: string;
    }>(`select * from applicants where id = $1`, [input.applicantId]);
    if (applicantRows.length === 0) {
      throw new NotFoundException(`Applicant ${input.applicantId} not found`);
    }
    const applicant = applicantRows[0];
    if (applicant.status !== 'admitted') {
      throw new ConflictException(
        `Cannot generate an admission letter for applicant ${input.applicantId}: it is '${applicant.status}', not admitted (FR-DOC-010)`,
      );
    }

    const branding = await this.getBranding();
    const content = {
      applicant: {
        id: input.applicantId,
        firstName: applicant.first_name,
        lastName: applicant.last_name,
        dob: applicant.dob,
        gender: applicant.gender,
      },
      admissionNo: applicant.admission_no,
      studentId: applicant.student_id,
      schoolId: applicant.school_id,
      branding,
    };

    const doc = await this.insertDocument('admission_letter', content, { applicantId: input.applicantId }, userId);
    return this.withQrCode(doc);
  }

  async generateCompletionCertificate(input: GenerateCompletionCertificateDto): Promise<GeneratedDocument & { qrCodeDataUri: string }> {
    const { userId } = TenantContextStore.current();

    const decisionRows = await this.db.query<{
      student_id: string;
      decision: string | null;
      status: string;
      applied_at: string | null;
    }>(`select student_id, decision, status, applied_at from promotion_decisions where id = $1`, [
      input.promotionDecisionId,
    ]);
    if (decisionRows.length === 0) {
      throw new NotFoundException(`Promotion decision ${input.promotionDecisionId} not found`);
    }
    const decision = decisionRows[0];
    if (decision.decision !== 'completed' || decision.status !== 'applied') {
      throw new ConflictException(
        `Cannot generate a completion certificate for promotion decision ${input.promotionDecisionId}: ` +
          `decision='${decision.decision}', status='${decision.status}' (requires decision='completed', status='applied')`,
      );
    }

    const studentRows = await this.db.query<{ first_name: string; last_name: string; admission_no: string }>(
      `select first_name, last_name, admission_no from students where id = $1`,
      [decision.student_id],
    );

    const branding = await this.getBranding();
    const content = {
      student: { id: decision.student_id, ...studentRows[0] },
      promotionDecisionId: input.promotionDecisionId,
      completedAt: decision.applied_at,
      branding,
    };

    const doc = await this.insertDocument(
      'completion_certificate',
      content,
      { promotionDecisionId: input.promotionDecisionId },
      userId,
    );
    return this.withQrCode(doc);
  }

  /** Reuses the Document Engine's existing snapshot/reference-number/
   * verification-token machinery for a payment receipt — see
   * 0008_finance.sql's header for why this is a 5th generated_documents
   * type rather than a parallel receipts table. */
  async generateReceipt(input: GenerateReceiptDto): Promise<GeneratedDocument & { qrCodeDataUri: string }> {
    const { userId } = TenantContextStore.current();

    const paymentRows = await this.db.query<{
      student_id: string;
      method: string;
      provider_reference: string | null;
      amount: string;
      currency: string;
      received_at: string;
    }>(`select student_id, method, provider_reference, amount, currency, received_at from payments where id = $1`, [
      input.paymentId,
    ]);
    if (paymentRows.length === 0) {
      throw new NotFoundException(`Payment ${input.paymentId} not found`);
    }
    const payment = paymentRows[0];

    const [studentRows, allocations, branding] = await Promise.all([
      this.db.query<{ first_name: string; last_name: string; admission_no: string }>(
        `select first_name, last_name, admission_no from students where id = $1`,
        [payment.student_id],
      ),
      this.db.query<{ invoice_id: string; amount: string; invoice_number: string }>(
        `select pa.invoice_id, pa.amount, i.invoice_number
         from payment_allocations pa join invoices i on i.id = pa.invoice_id
         where pa.payment_id = $1`,
        [input.paymentId],
      ),
      this.getBranding(),
    ]);

    const content = {
      student: { id: payment.student_id, ...studentRows[0] },
      method: payment.method,
      providerReference: payment.provider_reference,
      amount: payment.amount,
      currency: payment.currency,
      receivedAt: payment.received_at,
      allocations,
      branding,
    };

    const doc = await this.insertDocument('receipt', content, { paymentId: input.paymentId }, userId);
    return this.withQrCode(doc);
  }

  /**
   * FR-DOC-020: reference_number is a per-tenant, human-readable sequence
   * (same "count existing + 1, unique constraint as the concurrency
   * backstop" pattern admissions.service.ts's convert() documents for
   * admission_no); verification_token is a separate, cryptographically
   * random, unguessable value — see 0007_promotion_documents.sql's header
   * for why those two must not be the same value.
   */
  private async insertDocument(
    documentType: string,
    content: unknown,
    source: {
      applicantId?: string;
      studentResultId?: string;
      studentId?: string;
      promotionDecisionId?: string;
      paymentId?: string;
    },
    userId: string,
  ): Promise<GeneratedDocument> {
    const countRows = await this.db.query<{ count: string }>(
      `select count(*) from generated_documents where document_type = $1`,
      [documentType],
    );
    const seq = Number(countRows[0].count) + 1;
    const referenceNumber = `${REFERENCE_PREFIXES[documentType]}-${String(seq).padStart(6, '0')}`;
    const verificationToken = randomBytes(24).toString('hex');

    const rows = await this.db.query<GeneratedDocument>(
      `insert into generated_documents
         (tenant_id, document_type, reference_number, verification_token, applicant_id, student_result_id,
          student_id, promotion_decision_id, payment_id, content, generated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       returning *`,
      [
        documentType,
        referenceNumber,
        verificationToken,
        source.applicantId ?? null,
        source.studentResultId ?? null,
        source.studentId ?? null,
        source.promotionDecisionId ?? null,
        source.paymentId ?? null,
        JSON.stringify(content),
        userId,
      ],
    );
    return rows[0];
  }
}
