-- ============================================================================
-- 0009_finance_assistance.sql
--
-- Implements SRS v2.1 Chapter 25 (Financial Assistance, Reversals &
-- Reconciliation, FR-FIN-010..040) — Finance Pass 2 of 2, layered on top
-- of 0008_finance.sql's fee structures / invoices / payments / receipts.
--
-- Scope notes (read before extending this):
--   - FR-FIN-010's "reason and, above a configurable threshold, a second
--     approver" is a real maker-checker state machine in
--     finance.service.ts (pending -> first_approved -> approved, or
--     pending -> approved directly below the threshold), not just a
--     boolean flag. The threshold itself is a fixed constant
--     (finance.service.ts's ASSISTANCE_SECOND_APPROVAL_THRESHOLD) rather
--     than a per-tenant configurable setting — no tenant-settings table
--     exists yet, same "documented Phase 1 config item" deferral as
--     grading's fixed heuristic or promotion's fixed heuristic. What IS
--     real: secondApproveAssistance() rejects the same user who did the
--     first approval — the actual substance of "a second approver", not
--     just a second button click.
--   - FR-FIN-020 ("reversals preserve the original transaction... nothing
--     is edited in place") is taken further here than anywhere else in
--     this codebase: reversing a payment or an approved assistance record
--     does not touch that row's own columns AT ALL (unlike, say,
--     assessment_structures' reopen(), which does flip a status column
--     in place). A reversal is purely an ADDITIONAL row in this table;
--     finance.service.ts's findInvoiceBalance() excludes anything with a
--     matching reversal from its sums rather than reading a "reversed"
--     flag on the original.
--   - reversed_entity_id is polymorphic across three tables (payments,
--     financial_assistance, invoices) via reversed_entity_type, with NO
--     foreign key — a single uuid column can't FK to three different
--     tables. generated_documents (0007_promotion_documents.sql) solves
--     the same polymorphism with four separate typed nullable columns and
--     real FKs; that shape doesn't fit here because there are only ever
--     one row per reversal and adding three more nullable FK columns for
--     a single always-populated reference would be worse than the
--     alternative. finance.service.ts's reversePayment()/
--     reverseAssistance()/cancelInvoice() each validate the target row
--     exists (and is visible under RLS, i.e. same tenant) before
--     inserting — that check is the substitute for the FK Postgres can't
--     express here.
--   - Invoice cancellation reuses this same reversals mechanism (a
--     reversal row with reversed_entity_type = 'invoice') AND flips
--     invoices.status to 'cancelled' — a value 0008_finance.sql's CHECK
--     constraint already allowed but nothing wrote until now. That status
--     flip is not "editing a posted transaction in place": total_amount
--     and invoice_items are never touched, only the administrative status
--     column, the same distinction publish()/lock() elsewhere in this
--     codebase already rely on.
--   - FR-FIN-030 (reconciliation against external bank/provider evidence)
--     is NOT built — meaningless without the real payment-provider
--     integration 0008_finance.sql's header already defers. FR-FIN-040's
--     eight dashboards are represented by exactly one — outstanding/
--     overdue balances (finance.service.ts's outstandingBalances(),
--     directly derivable from tables that already exist) — the other
--     seven (today's collections, unverified transactions, collection
--     target vs. actual, unallocated credits, pending reversals/
--     assistance, reconciliation differences, failed deliveries) are
--     documented future work, several depending on the deferred payment
--     integration anyway.
-- ============================================================================

create table financial_assistance (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id),
  student_id                uuid not null,
  invoice_id                uuid not null,
  type                      text not null check (type in ('scholarship', 'discount', 'waiver', 'sponsor_credit')),
  amount                    numeric(10, 2) not null check (amount > 0),
  reason                    text not null,
  -- Computed once at request time against the threshold in effect then —
  -- never recomputed if the (currently hardcoded) threshold constant
  -- changes later, so an in-flight request's approval requirement stays
  -- stable.
  requires_second_approval  boolean not null,
  status                    text not null default 'pending' check (status in ('pending', 'first_approved', 'approved', 'rejected')),
  requested_by              uuid,
  requested_at              timestamptz not null default now(),
  first_approved_by         uuid,
  first_approved_at         timestamptz,
  approved_by               uuid,
  approved_at               timestamptz,
  rejected_by               uuid,
  rejected_at               timestamptz,
  rejection_reason          text,
  created_at                timestamptz not null default now(),
  created_by                uuid,
  updated_at                timestamptz not null default now(),
  updated_by                uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id),
  foreign key (tenant_id, invoice_id) references invoices (tenant_id, id)
);
create index idx_financial_assistance_tenant on financial_assistance (tenant_id);
create index idx_financial_assistance_tenant_invoice on financial_assistance (tenant_id, invoice_id);

alter table financial_assistance enable row level security;
create policy tenant_isolation_financial_assistance on financial_assistance
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table reversals (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  reversed_entity_type  text not null check (reversed_entity_type in ('payment', 'financial_assistance', 'invoice')),
  reversed_entity_id    uuid not null,
  amount                numeric(10, 2) not null check (amount > 0),
  reason                text not null,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  unique (tenant_id, id),
  -- DB-enforced "no double reversal of the same thing" — the same
  -- "prefer a real constraint over trusting application code" instinct
  -- as every EXCLUDE/partial-unique-index precedent in this codebase.
  unique (tenant_id, reversed_entity_type, reversed_entity_id)
);
create index idx_reversals_tenant on reversals (tenant_id);

alter table reversals enable row level security;
create policy tenant_isolation_reversals on reversals
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on financial_assistance, reversals to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
