/**
 * finance.service.ts
 *
 * Implements SRS v2.1 Chapter 23 (Fee Structures), the record-model half
 * of Chapter 24 (Invoicing, Payments, Allocation & Receipts), and Chapter
 * 25 (Financial Assistance, Reversals & Reconciliation — Pass 2). See
 * 0008_finance.sql's and 0009_finance_assistance.sql's headers for the
 * full list of deliberate scope cuts (only manual/offline payment methods
 * work; no real Paystack/Hubtel/MTN MoMo/Telecel integration; no
 * configurable per-tenant approval threshold; only one of FR-FIN-040's
 * eight dashboards).
 *
 * activateFeeStructure() and generateInvoice()/allocate() follow this
 * codebase's now-established shapes: activateFeeStructure() mirrors
 * assessment.service.ts's publish() / grading.service.ts's
 * activatePolicy() (cross-row sum/coverage check, `for update` lock,
 * atomic status flip); generateInvoice() snapshots fee_structure_items
 * into invoice_items the same way results.service.ts snapshots
 * result_candidates; allocate() locks both the payment and invoice rows
 * it validates against before inserting, for the same concurrent-
 * interleaving reason every other cross-row validate-then-write method in
 * this codebase does.
 *
 * findInvoiceBalance() is the one method every Pass 2 write path
 * ultimately feeds: reversePayment()/reverseAssistance() don't touch the
 * rows they reverse, so this query — not those rows' own columns — is
 * where a reversal actually takes effect (see
 * 0009_finance_assistance.sql's header).
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { CreateFeeStructureDto } from './dto/create-fee-structure.dto';
import { AddFeeStructureItemDto } from './dto/add-fee-structure-item.dto';
import { AddInstalmentDto } from './dto/add-instalment.dto';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { AllocatePaymentDto } from './dto/allocate-payment.dto';
import { RequestAssistanceDto } from './dto/request-assistance.dto';
import { RejectAssistanceDto } from './dto/reject-assistance.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';
import { ReverseAssistanceDto } from './dto/reverse-assistance.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { CreatePenaltyRuleDto } from './dto/create-penalty-rule.dto';
import { ApplyPenaltyDto } from './dto/apply-penalty.dto';
import { ReversePenaltyChargeDto } from './dto/reverse-penalty-charge.dto';

export interface FeeStructure {
  id: string;
  tenant_id: string;
  academic_year_id: string;
  level: string;
  name: string;
  status: string;
}

export interface FeeStructureItem {
  id: string;
  tenant_id: string;
  fee_structure_id: string;
  name: string;
  amount: string;
}

export interface FeeInstalment {
  id: string;
  tenant_id: string;
  fee_structure_id: string;
  sequence: number;
  amount: string;
  due_date: string;
}

export interface Invoice {
  id: string;
  tenant_id: string;
  student_id: string;
  fee_structure_id: string;
  invoice_number: string;
  status: string;
  proration_factor: string;
  total_amount: string;
  due_date: string | null;
  issued_at: string;
  issued_by: string | null;
}

export interface InvoiceItem {
  id: string;
  tenant_id: string;
  invoice_id: string;
  description: string;
  amount: string;
}

export interface Payment {
  id: string;
  tenant_id: string;
  student_id: string;
  method: string;
  provider: string | null;
  provider_reference: string | null;
  status: string;
  amount: string;
  currency: string;
  received_at: string;
  received_by: string | null;
}

export interface PaymentAllocation {
  id: string;
  tenant_id: string;
  payment_id: string;
  invoice_id: string;
  amount: string;
}

export interface InvoiceBalance {
  invoiceId: string;
  totalAmount: number;
  allocated: number;
  assisted: number;
  balance: number;
  cancelled: boolean;
}

export interface PenaltyRule {
  id: string;
  tenant_id: string;
  fee_structure_id: string;
  name: string;
  trigger_type: string;
  grace_period_days: number;
  amount_type: string;
  amount: string;
  cap_amount: string | null;
  frequency: string;
  status: string;
}

export interface PenaltyCharge {
  id: string;
  tenant_id: string;
  invoice_id: string;
  penalty_rule_id: string;
  amount: string;
  applied_at: string;
  applied_by: string | null;
  reason: string | null;
  reversed: boolean;
}

export interface FinancialAssistance {
  id: string;
  tenant_id: string;
  student_id: string;
  invoice_id: string;
  type: string;
  amount: string;
  reason: string;
  requires_second_approval: boolean;
  status: string;
  requested_by: string | null;
  requested_at: string;
  first_approved_by: string | null;
  first_approved_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
}

export interface Reversal {
  id: string;
  tenant_id: string;
  reversed_entity_type: string;
  reversed_entity_id: string;
  amount: string;
  reason: string;
  created_by: string | null;
  created_at: string;
}

export interface OutstandingBalance {
  invoice_id: string;
  invoice_number: string;
  student_id: string;
  total_amount: string;
  balance: number;
  due_date: string | null;
  overdue: boolean;
}

const NOT_YET_IMPLEMENTED_METHODS = new Set(['mobile_money', 'card']);
const INSTALMENT_SUM_EPSILON = 0.005; // same reasoning as grading's GAP_EPSILON — numeric(10,2) rounding noise

// FR-FIN-010: "above a configurable threshold, a second approver" — fixed
// here (no per-tenant settings table exists yet); see this file's and
// 0009_finance_assistance.sql's header comments.
const ASSISTANCE_SECOND_APPROVAL_THRESHOLD = 500;

// FR-FEE-040 frequency -> minimum whole days between two non-reversed
// charges of the same rule on the same invoice. 'monthly' is a fixed
// 30-day approximation, the same calendar-interval simplification
// job_schedules (0027_background_jobs.sql) already makes for recurrence —
// this schema has no real calendar/term model to do better.
const PENALTY_FREQUENCY_MIN_INTERVAL_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

@Injectable()
export class FinanceService {
  constructor(private readonly db: TenantDatabaseService) {}

  // ---------------------------------------------------------------------
  // Fee structures
  // ---------------------------------------------------------------------

  async createFeeStructure(input: CreateFeeStructureDto): Promise<FeeStructure> {
    const { userId } = TenantContextStore.current();
    // Pre-check fee_structures' (tenant_id, academic_year_id, level) unique
    // constraint (0008_finance.sql) so a collision returns a clean 409, the
    // same way every other uniqueness rule in this file does, rather than
    // letting the insert raise a raw, unhandled 500.
    const existing = await this.db.query<{ id: string }>(
      `select id from fee_structures where academic_year_id = $1 and level = $2`,
      [input.academicYearId, input.level],
    );
    if (existing.length > 0) {
      throw new ConflictException(
        `A fee structure for level '${input.level}' already exists in academic year ${input.academicYearId}`,
      );
    }
    const rows = await this.db.query<FeeStructure>(
      `insert into fee_structures (tenant_id, academic_year_id, level, name, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $4)
       returning *`,
      [input.academicYearId, input.level, input.name, userId],
    );
    return rows[0];
  }

  async findAllFeeStructures(): Promise<FeeStructure[]> {
    return this.db.query<FeeStructure>(`select * from fee_structures order by created_at desc`);
  }

  async findFeeStructure(id: string): Promise<FeeStructure> {
    const rows = await this.db.query<FeeStructure>(`select * from fee_structures where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Fee structure ${id} not found`);
    }
    return rows[0];
  }

  async addFeeStructureItem(feeStructureId: string, input: AddFeeStructureItemDto): Promise<FeeStructureItem> {
    const structure = await this.findFeeStructure(feeStructureId);
    if (structure.status !== 'draft') {
      throw new ConflictException(
        `Cannot add an item to fee structure ${feeStructureId}: it is '${structure.status}', not 'draft'`,
      );
    }
    const rows = await this.db.query<FeeStructureItem>(
      `insert into fee_structure_items (tenant_id, fee_structure_id, name, amount, created_by)
       values (current_tenant_id(), $1, $2, $3, $4)
       returning *`,
      [feeStructureId, input.name, input.amount, TenantContextStore.current().userId],
    );
    return rows[0];
  }

  async findFeeStructureItems(feeStructureId: string): Promise<FeeStructureItem[]> {
    return this.db.query<FeeStructureItem>(
      `select * from fee_structure_items where fee_structure_id = $1 order by name`,
      [feeStructureId],
    );
  }

  /** FR-FEE-020: `percentage` is resolved to an absolute amount against
   * the CURRENT sum of the structure's items at insert time — adding
   * more items afterwards does not retroactively rescale an
   * already-added percentage-based instalment. */
  async addInstalment(feeStructureId: string, input: AddInstalmentDto): Promise<FeeInstalment> {
    const { userId } = TenantContextStore.current();
    const structure = await this.findFeeStructure(feeStructureId);
    if (structure.status !== 'draft') {
      throw new ConflictException(
        `Cannot add an instalment to fee structure ${feeStructureId}: it is '${structure.status}', not 'draft'`,
      );
    }
    if (input.amount === undefined && input.percentage === undefined) {
      throw new ConflictException(`Instalment requires either 'amount' or 'percentage'`);
    }

    let amount = input.amount;
    if (amount === undefined) {
      const items = await this.findFeeStructureItems(feeStructureId);
      const total = items.reduce((sum, i) => sum + Number(i.amount), 0);
      if (total === 0) {
        throw new ConflictException(
          `Cannot resolve a percentage-based instalment for fee structure ${feeStructureId}: it has no items defined yet`,
        );
      }
      amount = Math.round(total * (input.percentage! / 100) * 100) / 100;
    }

    const rows = await this.db.query<FeeInstalment>(
      `insert into fee_instalments (tenant_id, fee_structure_id, sequence, amount, due_date, created_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5)
       returning *`,
      [feeStructureId, input.sequence, amount, input.dueDate, userId],
    );
    return rows[0];
  }

  async findInstalments(feeStructureId: string): Promise<FeeInstalment[]> {
    return this.db.query<FeeInstalment>(
      `select * from fee_instalments where fee_structure_id = $1 order by sequence`,
      [feeStructureId],
    );
  }

  async activateFeeStructure(id: string): Promise<FeeStructure> {
    await this.db.query('BEGIN');
    try {
      const structureRows = await this.db.query<FeeStructure>(
        `select * from fee_structures where id = $1 for update`,
        [id],
      );
      if (structureRows.length === 0) {
        throw new NotFoundException(`Fee structure ${id} not found`);
      }
      const structure = structureRows[0];
      if (structure.status !== 'draft') {
        throw new ConflictException(`Cannot activate fee structure ${id}: it is '${structure.status}', not 'draft'`);
      }

      const items = await this.db.query<FeeStructureItem>(
        `select * from fee_structure_items where fee_structure_id = $1`,
        [id],
      );
      if (items.length === 0) {
        throw new ConflictException(`Cannot activate fee structure ${id}: it has no items defined`);
      }
      const instalments = await this.db.query<FeeInstalment>(
        `select * from fee_instalments where fee_structure_id = $1`,
        [id],
      );
      if (instalments.length === 0) {
        throw new ConflictException(`Cannot activate fee structure ${id}: it has no instalments defined`);
      }

      const itemsTotal = items.reduce((sum, i) => sum + Number(i.amount), 0);
      const instalmentsTotal = instalments.reduce((sum, i) => sum + Number(i.amount), 0);
      if (Math.abs(itemsTotal - instalmentsTotal) > INSTALMENT_SUM_EPSILON) {
        throw new ConflictException(
          `Cannot activate fee structure ${id}: instalments sum to ${instalmentsTotal}, items sum to ${itemsTotal} (FR-FEE-020 requires equality)`,
        );
      }

      const updatedRows = await this.db.query<FeeStructure>(
        `update fee_structures set status = 'active', updated_at = now(), updated_by = $1 where id = $2 returning *`,
        [TenantContextStore.current().userId, id],
      );
      await this.db.query('COMMIT');
      return updatedRows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Invoices
  // ---------------------------------------------------------------------

  async generateInvoice(input: GenerateInvoiceDto): Promise<Invoice> {
    const { userId } = TenantContextStore.current();
    const structure = await this.findFeeStructure(input.feeStructureId);
    if (structure.status !== 'active') {
      throw new ConflictException(
        `Cannot generate an invoice from fee structure ${input.feeStructureId}: it is '${structure.status}', not 'active'`,
      );
    }
    const items = await this.findFeeStructureItems(input.feeStructureId);
    const prorationFactor = input.prorationFactor ?? 1;

    const proratedItems = items.map((item) => ({
      description: item.name,
      amount: Math.round(Number(item.amount) * prorationFactor * 100) / 100,
    }));
    const totalAmount = proratedItems.reduce((sum, i) => sum + i.amount, 0);

    const instalments = await this.findInstalments(input.feeStructureId);
    const dueDate =
      instalments.length === 0
        ? null
        : instalments.reduce((latest, i) => (i.due_date > latest ? i.due_date : latest), instalments[0].due_date);

    await this.db.query('BEGIN');
    try {
      const countRows = await this.db.query<{ count: string }>(`select count(*) from invoices`);
      const seq = Number(countRows[0].count) + 1;
      const invoiceNumber = `INV-${String(seq).padStart(6, '0')}`;

      const invoiceRows = await this.db.query<Invoice>(
        `insert into invoices
           (tenant_id, student_id, fee_structure_id, invoice_number, proration_factor, total_amount, due_date, issued_by, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $7, $7)
         returning *`,
        [input.studentId, input.feeStructureId, invoiceNumber, prorationFactor, totalAmount, dueDate, userId],
      );
      const invoice = invoiceRows[0];

      for (const item of proratedItems) {
        await this.db.query(
          `insert into invoice_items (tenant_id, invoice_id, description, amount) values (current_tenant_id(), $1, $2, $3)`,
          [invoice.id, item.description, item.amount],
        );
      }

      await this.db.query('COMMIT');
      return invoice;
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  async findAllInvoices(): Promise<Invoice[]> {
    return this.db.query<Invoice>(`select * from invoices order by issued_at desc`);
  }

  async findInvoice(id: string): Promise<Invoice> {
    const rows = await this.db.query<Invoice>(`select * from invoices where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    return rows[0];
  }

  async findInvoiceItems(invoiceId: string): Promise<InvoiceItem[]> {
    return this.db.query<InvoiceItem>(`select * from invoice_items where invoice_id = $1 order by description`, [
      invoiceId,
    ]);
  }

  /**
   * A cancelled invoice always reports balance 0, regardless of
   * allocated/assisted history — cancellation voids what's owed, it
   * doesn't matter what was paid or forgiven beforehand (see
   * 0009_finance_assistance.sql's header). For any other invoice, both
   * sums here deliberately exclude reversed rows via a `not exists`
   * against `reversals` rather than reading a "reversed" flag off
   * payments/financial_assistance themselves — those rows are never
   * touched by a reversal (FR-FIN-020).
   */
  async findInvoiceBalance(invoiceId: string): Promise<InvoiceBalance> {
    const invoice = await this.findInvoice(invoiceId);
    const totalAmount = Number(invoice.total_amount);

    if (invoice.status === 'cancelled') {
      return { invoiceId, totalAmount, allocated: 0, assisted: 0, balance: 0, cancelled: true };
    }

    const allocatedRows = await this.db.query<{ total: string | null }>(
      `select sum(pa.amount) as total
       from payment_allocations pa
       where pa.invoice_id = $1
         and not exists (
           select 1 from reversals r
           where r.reversed_entity_type = 'payment' and r.reversed_entity_id = pa.payment_id
         )`,
      [invoiceId],
    );
    const allocated = Number(allocatedRows[0].total ?? 0);

    const assistedRows = await this.db.query<{ total: string | null }>(
      `select sum(fa.amount) as total
       from financial_assistance fa
       where fa.invoice_id = $1 and fa.status = 'approved'
         and not exists (
           select 1 from reversals r
           where r.reversed_entity_type = 'financial_assistance' and r.reversed_entity_id = fa.id
         )`,
      [invoiceId],
    );
    const assisted = Number(assistedRows[0].total ?? 0);

    return {
      invoiceId,
      totalAmount,
      allocated,
      assisted,
      balance: Math.round((totalAmount - allocated - assisted) * 100) / 100,
      cancelled: false,
    };
  }

  // ---------------------------------------------------------------------
  // Fee penalties (FR-FEE-040) — see 0032_fee_penalties.sql's header for
  // why this is a manual-trigger-only, parallel ledger that does not feed
  // findInvoiceBalance() above.
  // ---------------------------------------------------------------------

  async createPenaltyRule(feeStructureId: string, input: CreatePenaltyRuleDto): Promise<PenaltyRule> {
    const { userId } = TenantContextStore.current();
    await this.findFeeStructure(feeStructureId); // 404s if it doesn't exist / isn't this tenant's
    const rows = await this.db.query<PenaltyRule>(
      `insert into fee_penalty_rules
         (tenant_id, fee_structure_id, name, grace_period_days, amount_type, amount, cap_amount, frequency, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $8)
       returning *`,
      [
        feeStructureId,
        input.name,
        input.gracePeriodDays ?? 0,
        input.amountType,
        input.amount,
        input.capAmount ?? null,
        input.frequency,
        userId,
      ],
    );
    return rows[0];
  }

  async findPenaltyRulesForStructure(feeStructureId: string): Promise<PenaltyRule[]> {
    return this.db.query<PenaltyRule>(
      `select * from fee_penalty_rules where fee_structure_id = $1 order by created_at desc`,
      [feeStructureId],
    );
  }

  async findPenaltyRule(id: string): Promise<PenaltyRule> {
    const rows = await this.db.query<PenaltyRule>(`select * from fee_penalty_rules where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Penalty rule ${id} not found`);
    }
    return rows[0];
  }

  async findPenaltiesForInvoice(invoiceId: string): Promise<PenaltyCharge[]> {
    return this.db.query<PenaltyCharge>(
      `select pc.*,
              exists (
                select 1 from reversals r
                where r.reversed_entity_type = 'fee_penalty_charge' and r.reversed_entity_id = pc.id
              ) as reversed
       from fee_penalty_charges pc
       where pc.invoice_id = $1
       order by pc.applied_at desc`,
      [invoiceId],
    );
  }

  /**
   * Always an explicit staff action against one specific invoice — never a
   * scheduled sweep (see 0032_fee_penalties.sql's header). Locks the
   * invoice row for the duration of the check-then-insert so two
   * concurrent applies against the same invoice+rule can't both slip past
   * the frequency/cap checks against the same "before" snapshot.
   */
  async applyPenalty(invoiceId: string, input: ApplyPenaltyDto): Promise<PenaltyCharge> {
    const { userId } = TenantContextStore.current();
    await this.db.query('BEGIN');
    try {
      const invoiceRows = await this.db.query<Invoice>(`select * from invoices where id = $1 for update`, [
        invoiceId,
      ]);
      if (invoiceRows.length === 0) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }
      const invoice = invoiceRows[0];
      if (invoice.status !== 'posted') {
        throw new ConflictException(`Cannot apply a penalty to invoice ${invoiceId}: it is '${invoice.status}', not 'posted'`);
      }

      const rule = await this.findPenaltyRule(input.penaltyRuleId);
      if (rule.fee_structure_id !== invoice.fee_structure_id) {
        throw new ConflictException(
          `Penalty rule ${input.penaltyRuleId} belongs to a different fee structure than invoice ${invoiceId}`,
        );
      }
      if (rule.status !== 'active') {
        throw new ConflictException(`Cannot apply penalty rule ${input.penaltyRuleId}: it is '${rule.status}', not 'active'`);
      }

      const balance = await this.findInvoiceBalance(invoiceId);
      if (balance.balance <= 0) {
        throw new ConflictException(`Cannot apply a penalty to invoice ${invoiceId}: it has no outstanding balance`);
      }

      const overdueRows = await this.db.query<{ days_overdue: number | null }>(
        `select (current_date - due_date) as days_overdue from invoices where id = $1`,
        [invoiceId],
      );
      const daysOverdue = overdueRows[0].days_overdue;
      if (daysOverdue === null || daysOverdue < rule.grace_period_days) {
        throw new ConflictException(
          `Cannot apply penalty rule ${input.penaltyRuleId} to invoice ${invoiceId}: not yet past its ` +
            `${rule.grace_period_days}-day grace period (${daysOverdue === null ? 'invoice has no due date' : `${daysOverdue} day(s) overdue`})`,
        );
      }

      const priorChargeRows = await this.db.query<{ id: string; amount: string; applied_at: string }>(
        `select pc.id, pc.amount, pc.applied_at
         from fee_penalty_charges pc
         where pc.invoice_id = $1 and pc.penalty_rule_id = $2
           and not exists (
             select 1 from reversals r
             where r.reversed_entity_type = 'fee_penalty_charge' and r.reversed_entity_id = pc.id
           )
         order by pc.applied_at desc`,
        [invoiceId, input.penaltyRuleId],
      );

      if (priorChargeRows.length > 0) {
        const lastCharge = priorChargeRows[0];
        if (rule.frequency === 'one_time') {
          throw new ConflictException(
            `Cannot apply penalty rule ${input.penaltyRuleId} again to invoice ${invoiceId}: it is 'one_time' and has already been applied`,
          );
        }
        const minIntervalDays = PENALTY_FREQUENCY_MIN_INTERVAL_DAYS[rule.frequency];
        const eligibleRows = await this.db.query<{ eligible: boolean }>(
          `select (now() - $1::timestamptz) >= ($2 || ' days')::interval as eligible`,
          [lastCharge.applied_at, minIntervalDays],
        );
        if (!eligibleRows[0].eligible) {
          throw new ConflictException(
            `Cannot apply penalty rule ${input.penaltyRuleId} again to invoice ${invoiceId} yet: its '${rule.frequency}' ` +
              `frequency requires at least ${minIntervalDays} day(s) since the last charge (applied ${lastCharge.applied_at})`,
          );
        }
      }

      const priorTotal = priorChargeRows.reduce((sum, c) => sum + Number(c.amount), 0);
      const rawAmount =
        rule.amount_type === 'fixed'
          ? Number(rule.amount)
          : Math.round(Number(invoice.total_amount) * (Number(rule.amount) / 100) * 100) / 100;
      let amount = rawAmount;
      if (rule.cap_amount !== null) {
        const remainingRoom = Math.round((Number(rule.cap_amount) - priorTotal) * 100) / 100;
        if (remainingRoom <= 0) {
          throw new ConflictException(
            `Cannot apply penalty rule ${input.penaltyRuleId} to invoice ${invoiceId}: its cap of ${rule.cap_amount} has already been reached`,
          );
        }
        amount = Math.min(rawAmount, remainingRoom);
      }

      const rows = await this.db.query<PenaltyCharge>(
        `insert into fee_penalty_charges (tenant_id, invoice_id, penalty_rule_id, amount, applied_by, reason)
         values (current_tenant_id(), $1, $2, $3, $4, $5)
         returning *, false as reversed`,
        [invoiceId, input.penaltyRuleId, amount, userId, `${daysOverdue} day(s) overdue, rule '${rule.name}'`],
      );
      await this.db.query('COMMIT');
      return rows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  async reversePenaltyCharge(chargeId: string, input: ReversePenaltyChargeDto): Promise<Reversal> {
    const { userId } = TenantContextStore.current();
    const chargeRows = await this.db.query<PenaltyCharge>(`select * from fee_penalty_charges where id = $1`, [
      chargeId,
    ]);
    if (chargeRows.length === 0) {
      throw new NotFoundException(`Penalty charge ${chargeId} not found`);
    }
    const charge = chargeRows[0];
    await this.assertNotAlreadyReversed('fee_penalty_charge', chargeId);
    const rows = await this.db.query<Reversal>(
      `insert into reversals (tenant_id, reversed_entity_type, reversed_entity_id, amount, reason, created_by)
       values (current_tenant_id(), 'fee_penalty_charge', $1, $2, $3, $4)
       returning *`,
      [chargeId, charge.amount, input.reason, userId],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------------

  async recordPayment(input: RecordPaymentDto): Promise<Payment> {
    const { userId } = TenantContextStore.current();
    if (NOT_YET_IMPLEMENTED_METHODS.has(input.method)) {
      throw new ConflictException(
        `Payment method '${input.method}' requires a real provider integration (FR-PAY-010, Chapter 36) that ` +
          `is not implemented in this scaffold — build the Paystack/Hubtel/MTN MoMo/Telecel adapter before enabling this path.`,
      );
    }
    const rows = await this.db.query<Payment>(
      `insert into payments
         (tenant_id, student_id, method, provider_reference, amount, currency, received_by, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $6, $6)
       returning *`,
      [
        input.studentId,
        input.method,
        input.providerReference ?? null,
        input.amount,
        input.currency ?? 'GHS',
        userId,
      ],
    );
    return rows[0];
  }

  async findAllPayments(): Promise<Payment[]> {
    return this.db.query<Payment>(`select * from payments order by received_at desc`);
  }

  async findPayment(id: string): Promise<Payment> {
    const rows = await this.db.query<Payment>(`select * from payments where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Payment ${id} not found`);
    }
    return rows[0];
  }

  async findAllocationsForPayment(paymentId: string): Promise<PaymentAllocation[]> {
    return this.db.query<PaymentAllocation>(`select * from payment_allocations where payment_id = $1`, [
      paymentId,
    ]);
  }

  async findAllocationsForInvoice(invoiceId: string): Promise<PaymentAllocation[]> {
    return this.db.query<PaymentAllocation>(`select * from payment_allocations where invoice_id = $1`, [
      invoiceId,
    ]);
  }

  /** `for update` on both the payment and invoice rows: this validates
   * against sibling data (prior allocations against each) and must not
   * interleave with a concurrent allocate() touching either one. */
  async allocate(paymentId: string, input: AllocatePaymentDto): Promise<PaymentAllocation> {
    const { userId } = TenantContextStore.current();
    await this.db.query('BEGIN');
    try {
      const paymentRows = await this.db.query<Payment>(`select * from payments where id = $1 for update`, [
        paymentId,
      ]);
      if (paymentRows.length === 0) {
        throw new NotFoundException(`Payment ${paymentId} not found`);
      }
      const payment = paymentRows[0];

      const invoiceRows = await this.db.query<Invoice>(`select * from invoices where id = $1 for update`, [
        input.invoiceId,
      ]);
      if (invoiceRows.length === 0) {
        throw new NotFoundException(`Invoice ${input.invoiceId} not found`);
      }
      const invoice = invoiceRows[0];
      if (invoice.status !== 'posted') {
        throw new ConflictException(`Cannot allocate to invoice ${input.invoiceId}: it is '${invoice.status}', not 'posted'`);
      }

      const paymentAllocatedRows = await this.db.query<{ total: string | null }>(
        `select sum(amount) as total from payment_allocations where payment_id = $1`,
        [paymentId],
      );
      const remainingOnPayment = Number(payment.amount) - Number(paymentAllocatedRows[0].total ?? 0);
      if (input.amount > remainingOnPayment + 0.005) {
        throw new ConflictException(
          `Cannot allocate ${input.amount}: only ${remainingOnPayment} remains unallocated on payment ${paymentId}`,
        );
      }

      const invoiceAllocatedRows = await this.db.query<{ total: string | null }>(
        `select sum(amount) as total from payment_allocations where invoice_id = $1`,
        [input.invoiceId],
      );
      const invoiceBalance = Number(invoice.total_amount) - Number(invoiceAllocatedRows[0].total ?? 0);
      if (input.amount > invoiceBalance + 0.005) {
        throw new ConflictException(
          `Cannot allocate ${input.amount}: only ${invoiceBalance} remains as balance on invoice ${input.invoiceId}`,
        );
      }

      const rows = await this.db.query<PaymentAllocation>(
        `insert into payment_allocations (tenant_id, payment_id, invoice_id, amount, created_by)
         values (current_tenant_id(), $1, $2, $3, $4)
         on conflict (tenant_id, payment_id, invoice_id)
         do update set amount = payment_allocations.amount + $3
         returning *`,
        [paymentId, input.invoiceId, input.amount, userId],
      );
      await this.db.query('COMMIT');
      return rows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Financial assistance (FR-FIN-010)
  // ---------------------------------------------------------------------

  async requestAssistance(input: RequestAssistanceDto): Promise<FinancialAssistance> {
    const { userId } = TenantContextStore.current();
    // Confirms the invoice exists (and is visible under RLS — same
    // tenant) before referencing it; also the natural place to reject a
    // request against an already-cancelled invoice.
    const invoice = await this.findInvoice(input.invoiceId);
    if (invoice.status !== 'posted') {
      throw new ConflictException(
        `Cannot request assistance against invoice ${input.invoiceId}: it is '${invoice.status}', not 'posted'`,
      );
    }
    const requiresSecondApproval = input.amount > ASSISTANCE_SECOND_APPROVAL_THRESHOLD;
    const rows = await this.db.query<FinancialAssistance>(
      `insert into financial_assistance
         (tenant_id, student_id, invoice_id, type, amount, reason, requires_second_approval, requested_by, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $7, $7)
       returning *`,
      [input.studentId, input.invoiceId, input.type, input.amount, input.reason, requiresSecondApproval, userId],
    );
    return rows[0];
  }

  async findAllAssistance(): Promise<FinancialAssistance[]> {
    return this.db.query<FinancialAssistance>(`select * from financial_assistance order by requested_at desc`);
  }

  async findAssistance(id: string): Promise<FinancialAssistance> {
    const rows = await this.db.query<FinancialAssistance>(`select * from financial_assistance where id = $1`, [
      id,
    ]);
    if (rows.length === 0) {
      throw new NotFoundException(`Assistance request ${id} not found`);
    }
    return rows[0];
  }

  /** Below the threshold this is the only approval needed; at/above it,
   * this is the FIRST of two — see secondApproveAssistance(). Only the
   * step that actually flips status to 'approved' checks the invoice's
   * balance — see finalizeAssistanceApproval()'s comment for why. The
   * first-approval step (when a second is required) makes no balance
   * commitment yet, so it needs no lock or check. */
  async approveAssistance(id: string): Promise<FinancialAssistance> {
    const { userId } = TenantContextStore.current();
    const assistance = await this.findAssistance(id);
    if (assistance.status !== 'pending') {
      throw new ConflictException(`Cannot approve assistance ${id}: it is '${assistance.status}', not 'pending'`);
    }
    if (!assistance.requires_second_approval) {
      return this.finalizeAssistanceApproval(assistance, userId);
    }
    const rows = await this.db.query<FinancialAssistance>(
      `update financial_assistance set status = 'first_approved', first_approved_by = $1, first_approved_at = now() where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  /** FR-FIN-010's actual "second approver" substance: rejected if the
   * caller is the same user who did the first approval, not just a second
   * click by anyone. */
  async secondApproveAssistance(id: string): Promise<FinancialAssistance> {
    const { userId } = TenantContextStore.current();
    const assistance = await this.findAssistance(id);
    if (assistance.status !== 'first_approved') {
      throw new ConflictException(
        `Cannot second-approve assistance ${id}: it is '${assistance.status}', not 'first_approved'`,
      );
    }
    if (assistance.first_approved_by === userId) {
      throw new ConflictException(
        `Cannot second-approve assistance ${id}: the second approver must be different from the first`,
      );
    }
    return this.finalizeAssistanceApproval(assistance, userId);
  }

  /**
   * The moment an assistance request actually starts reducing what's
   * owed — so this is where its amount is capped at the invoice's
   * CURRENT balance, the same "never let a credit push a balance
   * negative" rule allocate() already enforces for payments. Caught live:
   * without this, approving several assistance requests that individually
   * looked reasonable at request time could jointly exceed the invoice's
   * total, since nothing checked the running total until this fix. `for
   * update` on the invoice for the same concurrent-interleaving reason as
   * every other balance-affecting write in this codebase.
   */
  private async finalizeAssistanceApproval(
    assistance: FinancialAssistance,
    approverId: string,
  ): Promise<FinancialAssistance> {
    await this.db.query('BEGIN');
    try {
      const invoiceRows = await this.db.query<Invoice>(`select * from invoices where id = $1 for update`, [
        assistance.invoice_id,
      ]);
      const invoice = invoiceRows[0];

      const allocatedRows = await this.db.query<{ total: string | null }>(
        `select sum(pa.amount) as total from payment_allocations pa
         where pa.invoice_id = $1
           and not exists (select 1 from reversals r where r.reversed_entity_type = 'payment' and r.reversed_entity_id = pa.payment_id)`,
        [assistance.invoice_id],
      );
      const assistedRows = await this.db.query<{ total: string | null }>(
        `select sum(fa.amount) as total from financial_assistance fa
         where fa.invoice_id = $1 and fa.status = 'approved' and fa.id != $2
           and not exists (select 1 from reversals r where r.reversed_entity_type = 'financial_assistance' and r.reversed_entity_id = fa.id)`,
        [assistance.invoice_id, assistance.id],
      );
      const committed = Number(allocatedRows[0].total ?? 0) + Number(assistedRows[0].total ?? 0);
      const remaining = Number(invoice.total_amount) - committed;
      if (Number(assistance.amount) > remaining + 0.005) {
        throw new ConflictException(
          `Cannot approve assistance ${assistance.id}: ${assistance.amount} exceeds invoice ${assistance.invoice_id}'s remaining balance of ${remaining}`,
        );
      }

      const rows = await this.db.query<FinancialAssistance>(
        `update financial_assistance set status = 'approved', approved_by = $1, approved_at = now() where id = $2 returning *`,
        [approverId, assistance.id],
      );
      await this.db.query('COMMIT');
      return rows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  async rejectAssistance(id: string, input: RejectAssistanceDto): Promise<FinancialAssistance> {
    const { userId } = TenantContextStore.current();
    const assistance = await this.findAssistance(id);
    if (!['pending', 'first_approved'].includes(assistance.status)) {
      throw new ConflictException(
        `Cannot reject assistance ${id}: it is '${assistance.status}', not pending/first_approved`,
      );
    }
    const rows = await this.db.query<FinancialAssistance>(
      `update financial_assistance
       set status = 'rejected', rejected_by = $1, rejected_at = now(), rejection_reason = $2
       where id = $3
       returning *`,
      [userId, input.reason, id],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------
  // Reversals (FR-FIN-020)
  // ---------------------------------------------------------------------

  async findAllReversals(): Promise<Reversal[]> {
    return this.db.query<Reversal>(`select * from reversals order by created_at desc`);
  }

  async findReversal(id: string): Promise<Reversal> {
    const rows = await this.db.query<Reversal>(`select * from reversals where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Reversal ${id} not found`);
    }
    return rows[0];
  }

  /** The payment row itself is never touched — see this file's and
   * 0009_finance_assistance.sql's header comments. The unique constraint
   * on (tenant_id, reversed_entity_type, reversed_entity_id) is the real
   * "already reversed" guard; the explicit pre-check here just turns that
   * into a clean 409 instead of a raw constraint-violation 500. */
  async reversePayment(paymentId: string, input: ReversePaymentDto): Promise<Reversal> {
    const { userId } = TenantContextStore.current();
    const payment = await this.findPayment(paymentId);
    await this.assertNotAlreadyReversed('payment', paymentId);
    const rows = await this.db.query<Reversal>(
      `insert into reversals (tenant_id, reversed_entity_type, reversed_entity_id, amount, reason, created_by)
       values (current_tenant_id(), 'payment', $1, $2, $3, $4)
       returning *`,
      [paymentId, payment.amount, input.reason, userId],
    );
    return rows[0];
  }

  async reverseAssistance(assistanceId: string, input: ReverseAssistanceDto): Promise<Reversal> {
    const { userId } = TenantContextStore.current();
    const assistance = await this.findAssistance(assistanceId);
    if (assistance.status !== 'approved') {
      throw new ConflictException(
        `Cannot reverse assistance ${assistanceId}: it is '${assistance.status}', not 'approved'`,
      );
    }
    await this.assertNotAlreadyReversed('financial_assistance', assistanceId);
    const rows = await this.db.query<Reversal>(
      `insert into reversals (tenant_id, reversed_entity_type, reversed_entity_id, amount, reason, created_by)
       values (current_tenant_id(), 'financial_assistance', $1, $2, $3, $4)
       returning *`,
      [assistanceId, assistance.amount, input.reason, userId],
    );
    return rows[0];
  }

  /** The only reversal that also touches its own target row — flipping
   * invoices.status to 'cancelled', which 0009_finance_assistance.sql's
   * header explains is an administrative status transition, not "editing
   * a posted transaction," same as publish()/lock() elsewhere. Both
   * writes happen in one transaction. */
  async cancelInvoice(invoiceId: string, input: CancelInvoiceDto): Promise<Reversal> {
    const { userId } = TenantContextStore.current();
    await this.db.query('BEGIN');
    try {
      const invoiceRows = await this.db.query<Invoice>(`select * from invoices where id = $1 for update`, [
        invoiceId,
      ]);
      if (invoiceRows.length === 0) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }
      const invoice = invoiceRows[0];
      if (invoice.status !== 'posted') {
        throw new ConflictException(`Cannot cancel invoice ${invoiceId}: it is '${invoice.status}', not 'posted'`);
      }

      const reversalRows = await this.db.query<Reversal>(
        `insert into reversals (tenant_id, reversed_entity_type, reversed_entity_id, amount, reason, created_by)
         values (current_tenant_id(), 'invoice', $1, $2, $3, $4)
         returning *`,
        [invoiceId, invoice.total_amount, input.reason, userId],
      );
      await this.db.query(`update invoices set status = 'cancelled', updated_at = now(), updated_by = $1 where id = $2`, [
        userId,
        invoiceId,
      ]);

      await this.db.query('COMMIT');
      return reversalRows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  private async assertNotAlreadyReversed(entityType: string, entityId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `select id from reversals where reversed_entity_type = $1 and reversed_entity_id = $2`,
      [entityType, entityId],
    );
    if (rows.length > 0) {
      throw new ConflictException(`Cannot reverse: ${entityType} ${entityId} has already been reversed`);
    }
  }

  // ---------------------------------------------------------------------
  // Dashboard (FR-FIN-040 — one of eight; see class header comment)
  // ---------------------------------------------------------------------

  /** Every posted invoice with a nonzero balance, flagged overdue if past
   * due_date. Computed as one query rather than looping
   * findInvoiceBalance() per invoice. */
  async outstandingBalances(): Promise<OutstandingBalance[]> {
    const rows = await this.db.query<{
      invoice_id: string;
      invoice_number: string;
      student_id: string;
      total_amount: string;
      due_date: string | null;
      allocated: string | null;
      assisted: string | null;
    }>(
      `select i.id as invoice_id, i.invoice_number, i.student_id, i.total_amount, i.due_date,
              (select sum(pa.amount) from payment_allocations pa
                 where pa.invoice_id = i.id
                   and not exists (select 1 from reversals r where r.reversed_entity_type = 'payment' and r.reversed_entity_id = pa.payment_id)
              ) as allocated,
              (select sum(fa.amount) from financial_assistance fa
                 where fa.invoice_id = i.id and fa.status = 'approved'
                   and not exists (select 1 from reversals r where r.reversed_entity_type = 'financial_assistance' and r.reversed_entity_id = fa.id)
              ) as assisted
       from invoices i
       where i.status = 'posted'`,
    );

    return rows
      .map((r) => {
        const totalAmount = Number(r.total_amount);
        const balance = Math.round((totalAmount - Number(r.allocated ?? 0) - Number(r.assisted ?? 0)) * 100) / 100;
        const overdue = r.due_date !== null && r.due_date < new Date().toISOString().slice(0, 10);
        return {
          invoice_id: r.invoice_id,
          invoice_number: r.invoice_number,
          student_id: r.student_id,
          total_amount: r.total_amount,
          balance,
          due_date: r.due_date,
          overdue,
        };
      })
      .filter((r) => r.balance > 0);
  }
}
