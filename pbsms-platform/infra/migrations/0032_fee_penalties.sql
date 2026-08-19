-- ============================================================================
-- 0032_fee_penalties.sql
--
-- Implements FR-FEE-040 ("Penalty rules specify trigger, grace period,
-- fixed or percentage amount, cap and frequency, tracked separately from
-- the base charge") — the one gap Stage 7 of the frontend build flagged as
-- genuinely missing schema (`apps/web/README.md`'s Stage 7 section).
--
-- Scope notes (read before extending this):
--   - **Manual trigger only, confirmed with the user before building this.**
--     `trigger_type` is a fixed 'invoice_overdue' — the only concrete
--     trigger this schema can evaluate (no other event type exists) — but
--     applying a rule to a specific invoice is always an explicit staff
--     action (finance.service.ts's applyPenalty()), never an automatic
--     background job. An unsupervised process that silently increases what
--     a family owes is a different, larger risk-acceptance question than
--     this pass was scoped to answer — same caution this codebase already
--     applied to the retention purge (0029_data_protection.sql) and every
--     other consequential-but-automatable action. A scheduled variant is a
--     real, separate follow-on (would reuse Phase D's `background_jobs`
--     infra directly), not attempted here.
--   - **Tracked as a parallel ledger, NOT merged into `invoices.total_amount`
--     or `finance.service.ts`'s `findInvoiceBalance()`** — a literal reading
--     of FR-FEE-040's own "tracked separately from the base charge", and it
--     avoids touching that method at all, which every Pass 2 write path
--     (reversals, dashboards, Parent View) already depends on being exactly
--     what it is today. Folding penalty charges into the collectible
--     balance a family/dashboard sees is a real, separate integration
--     decision — flagged here, not silently done.
--   - `fee_penalty_rules.fee_structure_id` (not a bare tenant-wide rule) —
--     same granularity FR-FEE-040 implies by sitting inside Chapter 23's
--     fee-structure configuration, and it means a rule is scoped exactly
--     like `fee_structure_items`/`fee_instalments` already are.
--   - `amount_type = 'percentage'` is a percentage of the INVOICE's
--     `total_amount` (the only base-charge figure that exists per invoice)
--     — not of the outstanding balance, which would make the charge shrink
--     as a family pays down the principal, an odd incentive for a penalty.
--   - `cap_amount` truncates rather than rejects: once the sum of a rule's
--     non-reversed charges on one invoice would exceed the cap,
--     applyPenalty() charges only the remaining room (and 409s once that
--     room is zero). This is a deliberate departure from this codebase's
--     usual "reject, never silently deviate from the requested amount"
--     rule for payment_allocations/financial_assistance — those cap a
--     CALLER-SUPPLIED amount, where truncating would silently under-record
--     what the caller thinks happened. Here the amount is entirely
--     system-computed from the rule, and "cap" in the FR text's own words
--     means "the maximum total penalty", so truncating to fit is the
--     literal feature, not a deviation from one.
--   - Reuses the existing `reversals` polymorphic ledger
--     (0009_finance_assistance.sql) for correcting a wrongly-applied
--     charge — widens its `reversed_entity_type` CHECK to add
--     'fee_penalty_charge' rather than inventing a second reversal
--     mechanism, the same reuse-over-duplicate reasoning
--     0008_finance.sql's header used for receipts (a 5th
--     generated_documents type, not a new table). The table's existing
--     `unique (tenant_id, reversed_entity_type, reversed_entity_id)`
--     constraint gives "no double reversal" for free, no new constraint
--     needed here.
-- ============================================================================

create table fee_penalty_rules (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  fee_structure_id    uuid not null,
  name                text not null,
  trigger_type        text not null default 'invoice_overdue' check (trigger_type in ('invoice_overdue')),
  grace_period_days   integer not null default 0 check (grace_period_days >= 0),
  amount_type         text not null check (amount_type in ('fixed', 'percentage')),
  amount              numeric(10, 2) not null check (amount > 0),
  cap_amount          numeric(10, 2) check (cap_amount is null or cap_amount > 0),
  frequency           text not null check (frequency in ('one_time', 'daily', 'weekly', 'monthly')),
  status              text not null default 'active' check (status in ('active', 'inactive')),
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, fee_structure_id) references fee_structures (tenant_id, id)
);
create index idx_fee_penalty_rules_tenant on fee_penalty_rules (tenant_id);
create index idx_fee_penalty_rules_tenant_structure on fee_penalty_rules (tenant_id, fee_structure_id);

alter table fee_penalty_rules enable row level security;
create policy tenant_isolation_fee_penalty_rules on fee_penalty_rules
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table fee_penalty_charges (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  invoice_id        uuid not null,
  penalty_rule_id   uuid not null,
  amount            numeric(10, 2) not null check (amount > 0),
  applied_at        timestamptz not null default now(),
  applied_by        uuid,
  reason            text,
  unique (tenant_id, id),
  foreign key (tenant_id, invoice_id) references invoices (tenant_id, id),
  foreign key (tenant_id, penalty_rule_id) references fee_penalty_rules (tenant_id, id)
);
create index idx_fee_penalty_charges_tenant on fee_penalty_charges (tenant_id);
create index idx_fee_penalty_charges_tenant_invoice on fee_penalty_charges (tenant_id, invoice_id);
create index idx_fee_penalty_charges_tenant_rule on fee_penalty_charges (tenant_id, penalty_rule_id);

alter table fee_penalty_charges enable row level security;
create policy tenant_isolation_fee_penalty_charges on fee_penalty_charges
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on fee_penalty_rules, fee_penalty_charges to pbsms_app;

alter table fee_penalty_rules add constraint fee_penalty_rules_created_by_fkey foreign key (created_by) references users(id);
alter table fee_penalty_rules add constraint fee_penalty_rules_updated_by_fkey foreign key (updated_by) references users(id);
alter table fee_penalty_charges add constraint fee_penalty_charges_applied_by_fkey foreign key (applied_by) references users(id);

alter table reversals drop constraint reversals_reversed_entity_type_check;
alter table reversals add constraint reversals_reversed_entity_type_check
  check (reversed_entity_type in ('payment', 'financial_assistance', 'invoice', 'fee_penalty_charge'));

-- ----------------------------------------------------------------------------
-- Sanity checks to run manually after applying this file:
--
-- 1. RLS enabled:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname IN ('fee_penalty_rules', 'fee_penalty_charges');
-- -- should return zero rows.
-- ----------------------------------------------------------------------------
