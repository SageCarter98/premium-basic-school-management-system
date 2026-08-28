import { type SeedConfig, type TenantSpec } from '../config.js';
import { MOMO_PROVIDERS } from '../corpus.js';
import { addDays, at, daysBetween, nextId, schoolDays, type Rng } from '../rng.js';
import type {
  Allocation, FeeItem, FeeStructure, Invoice, InvoiceLine, Payment, Pesewas,
  ProviderSettlement, SettlementLine, TenantGraph,
} from '../types.js';

/** Termly fee in pesewas, by ladder sequence. Nursery cheapest, JHS 3 dearest. */
function tuitionFor(sequence: number): Pesewas {
  return 45000 + sequence * 9500; // GH¢450.00 .. GH¢573.50
}

const CATEGORIES: { category: FeeItem['category']; amount: Pesewas; optional: boolean }[] = [
  { category: 'feeding', amount: 24000, optional: true },
  { category: 'exam', amount: 6000, optional: false },
  { category: 'pta', amount: 4000, optional: false },
  { category: 'ict', amount: 5000, optional: false },
  { category: 'transport', amount: 30000, optional: true },
];

export function generateFinance(g: TenantGraph, spec: TenantSpec, cfg: SeedConfig, rng: Rng): void {
  const tid = g.tenant.id;
  const scope = spec.slug;
  const fRng = rng.stream('finance');

  for (const school of g.schools) {
    const years = g.academic_years.filter((y) => y.school_id === school.id).sort((a, b) => a.label.localeCompare(b.label));
    const currentYear = years[years.length - 1];
    const terms = g.terms.filter((t) => t.academic_year_id === currentYear.id).sort((a, b) => a.sequence - b.sequence);
    const levels = g.class_levels.filter((l) => g.divisions.some((d) => d.id === l.division_id && d.school_id === school.id));
    const accountant = g.staff.find((s) => s.school_id === school.id && s.roles.includes('accountant'))!;
    const head = g.staff.find((s) => s.school_id === school.id && s.roles.includes('headmaster'))!;
    const campusIds = new Set(g.campuses.filter((c) => c.school_id === school.id).map((c) => c.id));

    /* --------------------------------------------------- fee structures */
    const structureByKey = new Map<string, FeeStructure>();
    for (const term of terms) {
      if (term.state === 'planned') continue;
      for (const lvl of levels) {
        const fs: FeeStructure = {
          tenant_id: tid,
          id: nextId('fst', scope),
          school_id: school.id,
          academic_year_id: currentYear.id,
          term_id: term.id,
          class_level_id: lvl.id,
          name: `${lvl.name} · ${term.name} ${currentYear.label}`,
        };
        g.fee_structures.push(fs);
        structureByKey.set(`${term.id}:${lvl.id}`, fs);

        g.fee_items.push({
          tenant_id: tid, id: nextId('fit', scope), fee_structure_id: fs.id,
          category: 'tuition', amount: tuitionFor(lvl.sequence), is_optional: false,
        });
        for (const c of CATEGORIES) {
          g.fee_items.push({
            tenant_id: tid, id: nextId('fit', scope), fee_structure_id: fs.id,
            category: c.category, amount: c.amount, is_optional: c.optional,
          });
        }
      }
    }

    /* -------------------------------------- financial assistance (first) */
    // Applied before invoicing so the discount is visible on the invoice line
    // rather than reconciled afterwards.
    const schoolStudents = g.students.filter((s) => s.school_id === school.id);
    const assisted = new Map<string, number>();
    if (schoolStudents.length >= 12) {
      const grants: { student: typeof schoolStudents[number]; kind: 'scholarship' | 'discount' | 'waiver'; pct: number; reason: string }[] = [
        { student: schoolStudents[7], kind: 'scholarship', pct: 100, reason: 'Best BECE candidate, previous cohort' },
        { student: schoolStudents[8], kind: 'discount', pct: 25, reason: 'Staff child' },
        { student: schoolStudents[9], kind: 'waiver', pct: 50, reason: 'Bereavement — approved by the board' },
      ];
      for (const gr of grants) {
        g.financial_assistance.push({
          tenant_id: tid,
          id: nextId('fas', scope),
          student_id: gr.student.id,
          academic_year_id: currentYear.id,
          kind: gr.kind,
          percent_off: gr.pct,
          reason: gr.reason,
          approved_by: head.id,
        });
        assisted.set(gr.student.id, gr.pct);
      }
    }

    /* ------------------------------------------------------- invoicing */
    let invoiceSeq = 0;
    for (const term of terms) {
      if (term.state === 'planned') continue;
      const termDays = schoolDays(term.starts_on, term.ends_on).length;

      for (const student of schoolStudents) {
        const enr = g.enrolments.find(
          (e) => e.student_id === student.id && e.academic_year_id === currentYear.id && campusIds.has(e.campus_id)
            && e.started_on <= term.ends_on && (e.ended_on === null || e.ended_on >= term.starts_on),
        );
        if (!enr) continue;
        const cls = g.classes.find((c) => c.id === enr.class_id)!;
        const fs = structureByKey.get(`${term.id}:${cls.class_level_id}`);
        if (!fs) continue;
        const items = g.fee_items.filter((i) => i.fee_structure_id === fs.id);

        // Proration: a student who joined after the term started is billed for
        // the school days they were actually present for. A flat full-term bill
        // here would hide the whole FR-FEE-030 code path.
        const joinedLate = enr.started_on > term.starts_on;
        const remaining = joinedLate ? schoolDays(enr.started_on, term.ends_on).length : termDays;
        const factor = joinedLate ? remaining / termDays : 1;
        const discount = (assisted.get(student.id) ?? 0) / 100;

        const issuedOn = joinedLate ? enr.started_on : addDays(term.starts_on, -7);
        const invoice: Invoice = {
          tenant_id: tid,
          id: nextId('inv', scope),
          student_id: student.id,
          term_id: term.id,
          invoice_no: `${school.code}/INV/${currentYear.label.slice(2, 4)}${term.sequence}/${String(++invoiceSeq).padStart(5, '0')}`,
          status: 'issued',
          issued_on: issuedOn,
          due_on: addDays(term.starts_on, 21),
          total: 0,
        };

        let total = 0;
        for (const item of items) {
          // Optional items taken by roughly half the roll.
          if (item.is_optional && !fRng.bool(0.5)) continue;
          const base = Math.round(item.amount * factor);
          const amount = item.category === 'tuition' ? Math.round(base * (1 - discount)) : base;
          if (amount === 0 && item.category !== 'tuition') continue;
          total += amount;
          g.invoice_lines.push({
            tenant_id: tid,
            id: nextId('ivl', scope),
            invoice_id: invoice.id,
            fee_item_id: item.id,
            description: joinedLate
              ? `${item.category} (prorated, ${remaining}/${termDays} days)`
              : item.category,
            amount,
            prorated_from: joinedLate ? enr.started_on : null,
          });
        }
        invoice.total = total;
        g.invoices.push(invoice);
      }
    }

    /* -------------------------------------------------------- payments */
    let receiptSeq = 0;
    const settlementLines: SettlementLine[] = [];

    for (const invoice of g.invoices.filter((i) => schoolStudents.some((s) => s.id === i.student_id))) {
      const lines = g.invoice_lines.filter((l) => l.invoice_id === invoice.id);
      if (lines.length === 0 || invoice.total === 0) {
        invoice.status = 'paid';
        continue;
      }
      const term = g.terms.find((t) => t.id === invoice.term_id)!;
      const closed = term.state === 'closed';

      // Closed terms mostly settle; the active term is mid-collection.
      let behaviour = fRng.weighted(
        ['full', 'part', 'none'] as const,
        closed ? [0.82, 0.13, 0.05] : [0.44, 0.4, 0.16],
      );
      // The leaver must actually owe money. Leaving it to chance means the
      // "student left owing fees" case is present in some runs and absent in
      // others, which is the worst possible property for a fixture.
      const owner = g.students.find((x) => x.id === invoice.student_id);
      if (owner?.status === 'transferred_out') behaviour = 'part';
      if (behaviour === 'none') {
        invoice.status = invoice.due_on < cfg.asOf ? 'overdue' : 'issued';
        continue;
      }

      const share = behaviour === 'full' ? 1 : fRng.float() * 0.4 + 0.15;
      const amount = Math.round(invoice.total * share);
      const method = fRng.weighted<Payment['method']>(
        ['cash', 'momo', 'card', 'bank_transfer'], [0.34, 0.48, 0.06, 0.12],
      );
      const isProvider = method === 'momo' || method === 'card';
      const providerFee = isProvider ? Math.round(amount * 0.0125) : 0;
      const receivedOn = addDays(invoice.issued_on, fRng.int(1, 30));
      const payment: Payment = {
        tenant_id: tid,
        id: nextId('pay', scope),
        student_id: invoice.student_id,
        receipt_no: `${school.code}/RCT/${String(++receiptSeq).padStart(5, '0')}`,
        method,
        provider: isProvider ? fRng.pick(MOMO_PROVIDERS) : null,
        provider_ref: isProvider ? `MP${fRng.int(100000000, 999999999)}` : null,
        amount,
        provider_fee: providerFee,
        state: 'confirmed',
        received_on: receivedOn > cfg.asOf ? cfg.asOf : receivedOn,
        received_by: accountant.id,
        reverses_payment_id: null,
        reversal_reason: null,
        reversal_requested_by: null,
        reversal_approved_by: null,
      };
      g.payments.push(payment);

      // Allocate across lines in order until the payment is exhausted. The
      // remainder is deliberately left visible rather than folded into the
      // invoice total, because unallocated credit is a real state (§8.5).
      let left = amount;
      for (const line of lines) {
        if (left <= 0) break;
        const alloc = Math.min(left, line.amount);
        left -= alloc;
        g.allocations.push({
          tenant_id: tid,
          id: nextId('aln', scope),
          payment_id: payment.id,
          invoice_line_id: line.id,
          amount: alloc,
          allocated_by: accountant.id,
          allocated_at: at(payment.received_on, 15, fRng.int(0, 59)),
        });
      }
      invoice.status = behaviour === 'full' ? 'paid' : invoice.due_on < cfg.asOf ? 'overdue' : 'part_paid';

      if (isProvider) {
        settlementLines.push({
          tenant_id: tid,
          id: nextId('stl', scope),
          settlement_id: '', // filled below
          provider_ref: payment.provider_ref!,
          amount: payment.amount,
          fee: payment.provider_fee,
          payment_id: payment.id,
          match_state: 'matched',
        });
      }
    }

    /* -------------------------------------------- finance edge cases */
    const schoolPayments = g.payments.filter((p) => schoolStudents.some((s) => s.id === p.student_id));

    // 1. Overpayment leaving unallocated credit on the account.
    if (schoolPayments.length > 3) {
      const target = g.invoices.find((i) => i.status === 'paid' && schoolStudents.some((s) => s.id === i.student_id));
      if (target) {
        const overpay: Payment = {
          tenant_id: tid,
          id: nextId('pay', scope),
          student_id: target.student_id,
          receipt_no: `${school.code}/RCT/${String(++receiptSeq).padStart(5, '0')}`,
          method: 'momo',
          provider: MOMO_PROVIDERS[0],
          provider_ref: `MP${fRng.int(100000000, 999999999)}`,
          amount: 20000,
          provider_fee: 250,
          state: 'confirmed',
          received_on: addDays(cfg.asOf, -12),
          received_by: accountant.id,
          reverses_payment_id: null,
          reversal_reason: null,
          reversal_requested_by: null,
          reversal_approved_by: null,
        };
        g.payments.push(overpay);
        // No allocation rows at all: GH¢200.00 sitting as credit. A balance
        // calculation that ignores unallocated payments will be wrong here,
        // which is exactly what should fail loudly.
      }
    }

    // 2. Reversal as a correcting entry with maker-checker (FR-FIN-020).
    //    The original is NOT deleted and NOT updated to zero.
    const reversible = schoolPayments.find((p) => p.method === 'cash' && p.amount > 10000);
    if (reversible) {
      reversible.state = 'reversed';
      g.payments.push({
        tenant_id: tid,
        id: nextId('pay', scope),
        student_id: reversible.student_id,
        receipt_no: `${school.code}/RCT/${String(++receiptSeq).padStart(5, '0')}`,
        method: reversible.method,
        provider: null,
        provider_ref: null,
        amount: -reversible.amount,
        provider_fee: 0,
        state: 'confirmed',
        received_on: addDays(reversible.received_on, 3),
        received_by: accountant.id,
        reverses_payment_id: reversible.id,
        reversal_reason: 'Receipted against the wrong sibling — corrected on the guardian statement',
        reversal_requested_by: accountant.id,
        reversal_approved_by: head.id, // four eyes: requester !== approver
      });
    }

    // 3. Reconciliation: a settlement short by exactly the provider fee is
    //    CORRECT and must not surface as a discrepancy (FR-FIN-030).
    if (settlementLines.length > 0) {
      const batch = settlementLines.slice(0, Math.min(settlementLines.length, 40));
      const gross = batch.reduce((a, l) => a + l.amount, 0);
      const fee = batch.reduce((a, l) => a + l.fee, 0);
      const settlement: ProviderSettlement = {
        tenant_id: tid,
        id: nextId('set', scope),
        school_id: school.id,
        provider: MOMO_PROVIDERS[0],
        settled_on: addDays(cfg.asOf, -4),
        gross_amount: gross,
        fee_amount: fee,
        net_amount: gross - fee, // short by the fee, by design
      };
      g.provider_settlements.push(settlement);
      for (const l of batch) {
        l.settlement_id = settlement.id;
        g.settlement_lines.push(l);
      }

      // Provider line with no internal payment (webhook lost).
      g.settlement_lines.push({
        tenant_id: tid,
        id: nextId('stl', scope),
        settlement_id: settlement.id,
        provider_ref: `MP${fRng.int(100000000, 999999999)}`,
        amount: 35000,
        fee: 438,
        payment_id: null,
        match_state: 'unmatched_provider',
      });

      // Internal payment the provider never settled.
      const orphan = schoolPayments.find((p) => p.method === 'momo' && p.state === 'confirmed');
      if (orphan) {
        g.settlement_lines.push({
          tenant_id: tid,
          id: nextId('stl', scope),
          settlement_id: settlement.id,
          provider_ref: orphan.provider_ref ?? 'UNKNOWN',
          amount: orphan.amount,
          fee: orphan.provider_fee,
          payment_id: orphan.id,
          match_state: 'unmatched_internal',
        });
      }

      // Amount mismatch, genuinely disputed.
      g.settlement_lines.push({
        tenant_id: tid,
        id: nextId('stl', scope),
        settlement_id: settlement.id,
        provider_ref: `MP${fRng.int(100000000, 999999999)}`,
        amount: 18000,
        fee: 225,
        payment_id: null,
        match_state: 'disputed',
      });
    }

    // 4. The transferred-out student keeps an outstanding balance. Leavers with
    //    debt are the single most common finance query in a real school office.
    const leaver = schoolStudents.find((s) => s.status === 'transferred_out');
    if (leaver) {
      for (const inv of g.invoices.filter((i) => i.student_id === leaver.id)) {
        if (inv.status === 'paid') continue;
        inv.status = 'overdue';
      }
    }

    // 5. A student on a 100% scholarship whose invoice total is genuinely zero.
    for (const inv of g.invoices.filter((i) => assisted.get(i.student_id) === 100)) {
      if (inv.total === 0) inv.status = 'paid';
    }
  }
}

/** Outstanding balance in pesewas: invoiced minus allocated, ignoring reversals' originals. */
export function balanceOf(g: TenantGraph, studentId: string): Pesewas {
  const invoices = g.invoices.filter((i) => i.student_id === studentId && i.status !== 'cancelled');
  const invoiced = invoices.reduce((a, i) => a + i.total, 0);
  const lineIds = new Set(g.invoice_lines.filter((l) => invoices.some((i) => i.id === l.invoice_id)).map((l) => l.id));
  const paid = g.allocations
    .filter((a) => lineIds.has(a.invoice_line_id))
    .filter((a) => {
      const p = g.payments.find((x) => x.id === a.payment_id);
      return p && p.state !== 'reversed';
    })
    .reduce((a, x) => a + x.amount, 0);
  return invoiced - paid;
}

export { daysBetween };
