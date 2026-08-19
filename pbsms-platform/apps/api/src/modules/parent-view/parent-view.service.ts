/**
 * parent-view.service.ts — Stage 6 (Parent View, SRS §6.3/§8.6/§8.7).
 * Runs inside a TenantContextStore resolved by tenant.middleware.ts's
 * PARENT_PATH_PREFIX branch, exactly like every other module — the only
 * unusual thing about a guardian's request already happened one layer up
 * (see that file). Reads its own tables directly (student_guardians,
 * attendance_records) the same way every other module does, and reuses
 * ResultsService/FinanceService for the two reads with real business
 * logic behind them (FR-RES-040's published-only filter; the
 * reversal-exclusion arithmetic in findInvoiceBalance()) rather than
 * re-deriving either.
 *
 * Every method re-checks `student_guardians` for the CURRENT guardian +
 * requested studentId — never trusts a studentId a caller supplies
 * without confirming this specific guardian is actually linked to it.
 */

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { ResultsService, StudentResult, StudentResultItem } from '../results/results.service';
import { FinanceService, Invoice, InvoiceBalance } from '../finance/finance.service';
import { NaccaService, CompetencyProfileRow } from '../nacca/nacca.service';

interface LinkedStudentRow {
  student_id: string;
  first_name: string;
  last_name: string;
  has_report_access: boolean;
  has_finance_access: boolean;
}

export interface AttendanceSummary {
  total: number;
  present: number;
  absent: number;
  late: number;
  percentage: number | null;
}

export interface ParentHomeStudent {
  studentId: string;
  firstName: string;
  lastName: string;
  hasReportAccess: boolean;
  hasFinanceAccess: boolean;
  latestResult: StudentResult | null;
  attendance: AttendanceSummary;
  totalBalance: number | null;
  nextDueDate: string | null;
}

@Injectable()
export class ParentViewService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly results: ResultsService,
    private readonly finance: FinanceService,
    private readonly nacca: NaccaService,
  ) {}

  private guardianId(): string {
    const { guardianId } = TenantContextStore.current();
    if (!guardianId) {
      // Structurally shouldn't happen — only tenant.middleware.ts's
      // PARENT_PATH_PREFIX branch resolves a context this service reads
      // from, and it always sets this. Fail loudly rather than proceed
      // with an undefined actor, same posture as TenantContextStore.current()
      // itself.
      throw new Error('ParentViewService called outside a resolved guardian context');
    }
    return guardianId;
  }

  private async linkedStudents(): Promise<LinkedStudentRow[]> {
    return this.db.query<LinkedStudentRow>(
      `select sg.student_id, s.first_name, s.last_name, sg.has_report_access, sg.has_finance_access
       from student_guardians sg
       join students s on s.id = sg.student_id
       where sg.guardian_id = $1 and s.deleted_at is null
       order by sg.is_primary_contact desc, s.first_name`,
      [this.guardianId()],
    );
  }

  /** Throws if the current guardian isn't actually linked to this student
   * — the one check every other method in this file depends on. */
  private async assertLinked(studentId: string): Promise<LinkedStudentRow> {
    const rows = await this.db.query<LinkedStudentRow>(
      `select sg.student_id, s.first_name, s.last_name, sg.has_report_access, sg.has_finance_access
       from student_guardians sg
       join students s on s.id = sg.student_id
       where sg.guardian_id = $1 and sg.student_id = $2`,
      [this.guardianId(), studentId],
    );
    if (rows.length === 0) {
      throw new ForbiddenException(`This access link is not associated with student ${studentId}`);
    }
    return rows[0];
  }

  private async attendanceSummary(studentId: string): Promise<AttendanceSummary> {
    const rows = await this.db.query<{ status: string }>(
      `select status from attendance_records where student_id = $1 and deleted_at is null`,
      [studentId],
    );
    const total = rows.length;
    const present = rows.filter((r) => r.status === 'present').length;
    const absent = rows.filter((r) => r.status === 'absent').length;
    const late = rows.filter((r) => r.status === 'late').length;
    return { total, present, absent, late, percentage: total > 0 ? Math.round((present / total) * 100) : null };
  }

  private async latestPublishedResult(studentId: string): Promise<StudentResult | null> {
    const published = await this.results.findPublishedForStudent(studentId);
    if (published.length === 0) return null;
    // findPublishedForStudent() orders by academic_year_id (a uuid, not
    // chronological) — "latest" here means most recently published.
    return published.slice().sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))[0];
  }

  private async balanceSummary(studentId: string): Promise<{ totalBalance: number; nextDueDate: string | null }> {
    const invoices = (await this.finance.findAllInvoices()).filter((inv) => inv.student_id === studentId);
    let totalBalance = 0;
    let nextDueDate: string | null = null;
    for (const inv of invoices) {
      const balance = await this.finance.findInvoiceBalance(inv.id);
      totalBalance += balance.balance;
      if (balance.balance > 0 && inv.due_date && (!nextDueDate || inv.due_date < nextDueDate)) {
        nextDueDate = inv.due_date;
      }
    }
    return { totalBalance, nextDueDate };
  }

  /** Spec §8.6 Parent Home: "how is my child doing, what do I owe, is
   * anything wrong" — answered per linked child, gated by that specific
   * link's has_report_access/has_finance_access flags (attendance has no
   * such flag in the schema, spec's own "is anything wrong" baseline
   * question, shown for every linked child regardless). */
  async getHome(): Promise<ParentHomeStudent[]> {
    const linked = await this.linkedStudents();
    const out: ParentHomeStudent[] = [];
    for (const s of linked) {
      const attendance = await this.attendanceSummary(s.student_id);
      const latestResult = s.has_report_access ? await this.latestPublishedResult(s.student_id) : null;
      const bal = s.has_finance_access ? await this.balanceSummary(s.student_id) : null;
      out.push({
        studentId: s.student_id,
        firstName: s.first_name,
        lastName: s.last_name,
        hasReportAccess: s.has_report_access,
        hasFinanceAccess: s.has_finance_access,
        latestResult,
        attendance,
        totalBalance: bal?.totalBalance ?? null,
        nextDueDate: bal?.nextDueDate ?? null,
      });
    }
    return out;
  }

  /** Spec §8.7 Report Card. `resultId` optionally names a SPECIFIC
   * version (FR-RES-030: "if a result was later revised, both versions
   * are reachable") — omit it to get the current one. Either way the
   * result's student_id is re-checked against this guardian's real link,
   * never trusted from the URL alone. */
  async getReportCard(
    studentId: string,
    resultId?: string,
  ): Promise<{ result: StudentResult; items: StudentResultItem[]; competencyProfiles: Record<string, CompetencyProfileRow[]> }> {
    const link = await this.assertLinked(studentId);
    if (!link.has_report_access) {
      throw new ForbiddenException('This access link does not include report access for this student');
    }
    let result: StudentResult;
    if (resultId) {
      result = await this.results.findOne(resultId);
      if (result.student_id !== studentId) {
        throw new ForbiddenException('That result does not belong to this student');
      }
    } else {
      const latest = await this.latestPublishedResult(studentId);
      if (!latest) {
        throw new NotFoundException(`No published result yet for student ${studentId}`);
      }
      result = latest;
    }
    const items = await this.results.findItems(result.id);

    // NaCCA competency data composed here, server-side, rather than a
    // second frontend call — the guardian access token this whole module
    // runs under isn't authorized to call /v1/nacca/* directly (Parent
    // View has its own tenant.middleware.ts branch, separate from the
    // Bearer-JWT path that route requires). Returns [] per subject when
    // the tenant hasn't adopted NaCCA or configured indicators for it —
    // competencyProfile() itself has no adoption gate, an empty join
    // result is the natural "nothing configured" case, not an error.
    const profiles = await Promise.all(items.map((item) => this.nacca.competencyProfile(studentId, item.subject_id, result.academic_year_id)));
    const competencyProfiles: Record<string, CompetencyProfileRow[]> = {};
    items.forEach((item, i) => {
      if (profiles[i].length > 0) competencyProfiles[item.subject_id] = profiles[i];
    });

    return { result, items, competencyProfiles };
  }

  /** Spec §8.6's "Balance"/"[See statement]". */
  async getInvoices(studentId: string): Promise<{ invoice: Invoice; balance: InvoiceBalance }[]> {
    const link = await this.assertLinked(studentId);
    if (!link.has_finance_access) {
      throw new ForbiddenException('This access link does not include finance access for this student');
    }
    const invoices = (await this.finance.findAllInvoices()).filter((inv) => inv.student_id === studentId);
    const withBalance = await Promise.all(
      invoices.map(async (invoice) => ({ invoice, balance: await this.finance.findInvoiceBalance(invoice.id) })),
    );
    return withBalance;
  }
}
