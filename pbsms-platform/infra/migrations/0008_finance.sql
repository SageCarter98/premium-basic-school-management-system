-- ============================================================================
-- 0008_finance.sql
--
-- Implements SRS v2.1 Chapter 23 (Fee Structures, FR-FEE-010..040) and the
-- record model half of Chapter 24 (Invoicing, Payments, Allocation &
-- Receipts, FR-PAY-040/050) — Pass 1 of a two-pass build. Chapter 25
-- (Financial Assistance, Reversals & Reconciliation, FR-FIN-010..040) is
-- Pass 2, layered on top of what this migration creates.
--
-- Scope notes (read before extending this):
--   - FR-PAY-010 names five payment rails: Paystack Ghana, Hubtel, MTN
--     Mobile Money, Telecel Cash, and manual/offline (cash, bank transfer,
--     cheque). ONLY manual/offline is actually implemented here —
--     finance.service.ts's recordPayment() rejects mobile_money/card the
--     same way tenant.middleware.ts rejects platform-role requests: "not
--     implemented in this scaffold" rather than silently accepting a
--     stub that looks real. The four real rails need actual provider
--     accounts, webhook signature verification, and the credential
--     registry Chapter 36.1 describes — none of which exist here. The
--     `method`/`provider`/`provider_reference`/`status` columns on
--     `payments` ARE shaped for that future integration (status already
--     has 'pending'/'verified'/'failed', unused by the manual path, which
--     goes straight to 'recorded') specifically so adding it later is a
--     new service method, not a column rename.
--   - FR-FEE-010's "configurable by academic year, term, campus, division,
--     class level and student category" is simplified to (academic_year,
--     level) — term/division/student-category need the still-unbuilt
--     Chapter 17 academic hierarchy (the same gap 0004_assessment.sql's
--     header notes for FR-ASM-020), and campus needs classes to carry a
--     campus_id, which they don't. `level` is a free-text match against
--     classes.level (e.g. 'JHS 2') rather than a class_id, deliberately —
--     scoping to one specific class/section would force a school with
--     multiple JHS 2 sections to duplicate the same fee structure per
--     section, which doesn't match "class level" being singular in the
--     requirement text.
--   - FR-FEE-030's proration is a single `proration_factor` (0, 1] applied
--     uniformly to every fee_structure_item at invoice-generation time —
--     "full" is 1.0, "percentage" is any caller-supplied factor. True
--     daily/monthly calendar proration needs term start/end dates, which
--     don't exist yet (same Chapter 17 gap).
--   - invoice_items is a SNAPSHOT of fee_structure_items at generation
--     time, not a live join — same "don't let a later edit retroactively
--     change an already-issued record" reasoning as student_result_items
--     (0006_results.sql) and generated_documents.content
--     (0007_promotion_documents.sql).
--   - Receipts are added here as a FIFTH generated_documents document_type
--     (0007_promotion_documents.sql), not a parallel table — reusing the
--     Document Engine's existing snapshot/reference-number/verification-
--     token machinery rather than rebuilding it. This is why
--     0007_promotion_documents.sql named its polymorphic-source CHECK
--     constraint explicitly: this migration needs to DROP and widen it.
--   - "Posted transactions are never silently edited or deleted"
--     (Chapter 23.1) is why invoices have no UPDATE path for amounts once
--     created — only a status transition to 'cancelled' will exist, and
--     that arrives in Pass 2 alongside reversals, not here. This
--     migration's generateInvoice() therefore always creates 'posted'
--     invoices directly; there is no draft/edit phase for an invoice.
--   - FR-FEE-020's instalment sum-equals-total check and FR-PAY-050's
--     "database transactions... idempotency protections" both live in
--     finance.service.ts (activateFeeStructure(), allocate()) — the same
--     "cross-row arithmetic can't be a CHECK constraint" reasoning
--     assessment.service.ts's publish() and grading.service.ts's
--     activatePolicy() already document.
-- ============================================================================

create table fee_structures (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  academic_year_id  uuid not null,
  level             text not null,
  name              text not null,
  status            text not null default 'draft' check (status in ('draft', 'active')),
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (tenant_id, id),
  unique (tenant_id, academic_year_id, level),
  foreign key (tenant_id, academic_year_id) references academic_years (tenant_id, id)
);
create index idx_fee_structures_tenant on fee_structures (tenant_id);

alter table fee_structures enable row level security;
create policy tenant_isolation_fee_structures on fee_structures
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table fee_structure_items (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  fee_structure_id  uuid not null,
  name              text not null,
  amount            numeric(10, 2) not null check (amount > 0),
  created_at        timestamptz not null default now(),
  created_by        uuid,
  unique (tenant_id, id),
  unique (tenant_id, fee_structure_id, name),
  foreign key (tenant_id, fee_structure_id) references fee_structures (tenant_id, id)
);
create index idx_fee_structure_items_tenant on fee_structure_items (tenant_id);
create index idx_fee_structure_items_tenant_structure on fee_structure_items (tenant_id, fee_structure_id);

alter table fee_structure_items enable row level security;
create policy tenant_isolation_fee_structure_items on fee_structure_items
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table fee_instalments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  fee_structure_id  uuid not null,
  sequence          integer not null check (sequence > 0),
  amount            numeric(10, 2) not null check (amount > 0),
  due_date          date not null,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  unique (tenant_id, id),
  unique (tenant_id, fee_structure_id, sequence),
  foreign key (tenant_id, fee_structure_id) references fee_structures (tenant_id, id)
);
create index idx_fee_instalments_tenant on fee_instalments (tenant_id);
create index idx_fee_instalments_tenant_structure on fee_instalments (tenant_id, fee_structure_id);

alter table fee_instalments enable row level security;
create policy tenant_isolation_fee_instalments on fee_instalments
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table invoices (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  student_id        uuid not null,
  fee_structure_id  uuid not null,
  invoice_number    text not null,
  status            text not null default 'posted' check (status in ('posted', 'cancelled')),
  proration_factor  numeric(4, 3) not null default 1.000 check (proration_factor > 0 and proration_factor <= 1),
  total_amount      numeric(10, 2) not null check (total_amount >= 0),
  due_date          date,
  issued_at         timestamptz not null default now(),
  issued_by         uuid,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (tenant_id, id),
  unique (tenant_id, invoice_number),
  foreign key (tenant_id, student_id) references students (tenant_id, id),
  foreign key (tenant_id, fee_structure_id) references fee_structures (tenant_id, id)
);
create index idx_invoices_tenant on invoices (tenant_id);
create index idx_invoices_tenant_student on invoices (tenant_id, student_id);

alter table invoices enable row level security;
create policy tenant_isolation_invoices on invoices
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table invoice_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  invoice_id   uuid not null,
  description  text not null,
  amount       numeric(10, 2) not null check (amount >= 0),
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, invoice_id) references invoices (tenant_id, id)
);
create index idx_invoice_items_tenant on invoice_items (tenant_id);
create index idx_invoice_items_tenant_invoice on invoice_items (tenant_id, invoice_id);

alter table invoice_items enable row level security;
create policy tenant_isolation_invoice_items on invoice_items
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table payments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  student_id          uuid not null,
  method              text not null check (method in ('cash', 'bank_transfer', 'cheque', 'mobile_money', 'card')),
  -- Null for the manual/offline methods this pass implements; would hold
  -- 'paystack'/'hubtel'/'mtn_momo'/'telecel' for a future real
  -- integration (FR-PAY-010).
  provider            text,
  -- Cashier-entered reference for manual methods; would hold the
  -- provider's transaction id for a future real integration.
  provider_reference  text,
  -- 'pending'/'verified'/'failed' are unused by this pass's code path —
  -- the manual method goes straight to 'recorded' — but exist now so a
  -- future async provider flow (FR-PAY-020) doesn't need a column rename.
  status              text not null default 'recorded' check (status in ('recorded', 'pending', 'verified', 'failed')),
  amount              numeric(10, 2) not null check (amount > 0),
  currency            text not null default 'GHS',
  received_at         timestamptz not null default now(),
  received_by         uuid,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id)
);
create index idx_payments_tenant on payments (tenant_id);
create index idx_payments_tenant_student on payments (tenant_id, student_id);

alter table payments enable row level security;
create policy tenant_isolation_payments on payments
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table payment_allocations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  payment_id   uuid not null,
  invoice_id   uuid not null,
  -- FR-PAY-050/24.1: capped in finance.service.ts's allocate() at both the
  -- payment's remaining unallocated amount AND the invoice's remaining
  -- balance — an over-allocation past either is a 409, not a truncated
  -- silent value. Neither cap is a CHECK constraint, for the same
  -- cross-row-arithmetic reason as everywhere else in this codebase.
  amount       numeric(10, 2) not null check (amount > 0),
  created_at   timestamptz not null default now(),
  created_by   uuid,
  unique (tenant_id, id),
  -- One allocation row per payment+invoice pair — re-allocating more of
  -- the same payment to the same invoice is a service-level "top up this
  -- row" concern, not a second row, avoiding ambiguity about which row is
  -- current.
  unique (tenant_id, payment_id, invoice_id),
  foreign key (tenant_id, payment_id) references payments (tenant_id, id),
  foreign key (tenant_id, invoice_id) references invoices (tenant_id, id)
);
create index idx_payment_allocations_tenant on payment_allocations (tenant_id);
create index idx_payment_allocations_tenant_payment on payment_allocations (tenant_id, payment_id);
create index idx_payment_allocations_tenant_invoice on payment_allocations (tenant_id, invoice_id);

alter table payment_allocations enable row level security;
create policy tenant_isolation_payment_allocations on payment_allocations
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on
  fee_structures, fee_structure_items, fee_instalments, invoices, invoice_items, payments, payment_allocations
to pbsms_app;

-- ----------------------------------------------------------------------------
-- Receipts: a 5th generated_documents document_type, not a new table — see
-- this migration's header. Both CHECK constraints on generated_documents
-- were named explicitly in 0007_promotion_documents.sql specifically so
-- they can be dropped and widened here rather than guessing an
-- auto-generated name.
-- ----------------------------------------------------------------------------

alter table generated_documents add column payment_id uuid;
alter table generated_documents
  add constraint generated_documents_payment_id_fkey
  foreign key (tenant_id, payment_id) references payments (tenant_id, id);

alter table generated_documents drop constraint generated_documents_document_type_check;
alter table generated_documents add constraint generated_documents_document_type_check
  check (document_type in ('report_card', 'transcript', 'admission_letter', 'completion_certificate', 'receipt'));

alter table generated_documents drop constraint generated_documents_source_check;
alter table generated_documents add constraint generated_documents_source_check check (
  (document_type = 'admission_letter' and applicant_id is not null and student_result_id is null and student_id is null and promotion_decision_id is null and payment_id is null)
  or (document_type = 'report_card' and student_result_id is not null and applicant_id is null and student_id is null and promotion_decision_id is null and payment_id is null)
  or (document_type = 'transcript' and student_id is not null and applicant_id is null and student_result_id is null and promotion_decision_id is null and payment_id is null)
  or (document_type = 'completion_certificate' and promotion_decision_id is not null and applicant_id is null and student_result_id is null and student_id is null and payment_id is null)
  or (document_type = 'receipt' and payment_id is not null and applicant_id is null and student_result_id is null and student_id is null and promotion_decision_id is null)
);

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
