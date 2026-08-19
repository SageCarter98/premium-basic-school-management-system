-- ============================================================================
-- 0034_settlement_reconciliation.sql
--
-- Implements the buildable half of SRS v2.1 spec §8.8's Reconciliation
-- Workspace ("provider settlement vs internal records") — the second gap
-- apps/web/README.md's Stage 7 section flagged as genuinely blocked ("no
-- provider integration and no settlement-record table at all").
--
-- Scope notes (read before extending this, confirmed with the user before
-- building — see 0008_finance.sql's header for the payments-side context
-- this builds on):
--   - Real-time provider webhook integration (Paystack/Hubtel/MTN MoMo/
--     Telecel) is OUT of scope here, same as `payments.method`'s
--     mobile_money/card rows being rejected as not-implemented
--     (finance.service.ts's NOT_YET_IMPLEMENTED_METHODS) — that needs real
--     vendor accounts and webhook signature verification (Chapter 36.1),
--     external prerequisites, not schema.
--   - What IS buildable, and what this migration builds: a settlement
--     BATCH (one row per statement a staff member enters or imports —
--     a bank statement, a MoMo settlement report, any external record of
--     money that arrived) containing LINES (one row per external
--     transaction: date, amount, reference, description), matched against
--     this schema's own `payments` table by provider_reference + amount.
--     This mirrors `payments` itself being manual-entry-only today — the
--     matching/discrepancy machinery is real and independently useful the
--     moment a real provider integration lands (it would just add more
--     payments rows to match against), the same "the seam is real, the
--     wiring behind it can come later" reasoning 0010_communication.sql's
--     WhatsApp/SMS/email stubs already established.
--   - `settlement_lines.matched_payment_id` uses a partial unique index
--     (one line per payment, not enforced the other way — one payment could
--     legitimately appear on the wrong settlement batch and need
--     re-matching, but never two lines simultaneously claiming the same
--     payment) so double-counting a single real payment across two
--     settlement lines is impossible at the schema level, not just an
--     application-level promise.
--   - `match_status = 'discrepancy'` is a genuinely linked-but-flagged
--     state (the line IS linked to a payment via matched_payment_id, but
--     the amounts didn't agree) — deliberately NOT the same as 'unmatched',
--     so a discrepancy report can distinguish "never found a candidate"
--     from "found one, but the numbers don't agree" (the more actionable
--     signal for a real bank reconciliation).
-- ============================================================================

create table settlement_batches (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  source            text not null,
  reference         text,
  period_start      date,
  period_end        date,
  status            text not null default 'open' check (status in ('open', 'closed')),
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (tenant_id, id)
);
create index idx_settlement_batches_tenant on settlement_batches (tenant_id);

alter table settlement_batches enable row level security;
create policy tenant_isolation_settlement_batches on settlement_batches
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table settlement_lines (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  settlement_batch_id   uuid not null,
  line_reference        text,
  amount                numeric(10, 2) not null check (amount > 0),
  value_date            date,
  description           text,
  matched_payment_id    uuid,
  match_status          text not null default 'unmatched' check (match_status in ('unmatched', 'matched', 'discrepancy')),
  matched_at            timestamptz,
  matched_by            uuid,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, settlement_batch_id) references settlement_batches (tenant_id, id),
  foreign key (tenant_id, matched_payment_id) references payments (tenant_id, id)
);
create index idx_settlement_lines_tenant on settlement_lines (tenant_id);
create index idx_settlement_lines_tenant_batch on settlement_lines (tenant_id, settlement_batch_id);

-- One payment can back at most one settlement line at a time (see header).
create unique index uq_settlement_lines_matched_payment
  on settlement_lines (tenant_id, matched_payment_id)
  where matched_payment_id is not null;

alter table settlement_lines enable row level security;
create policy tenant_isolation_settlement_lines on settlement_lines
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on settlement_batches, settlement_lines to pbsms_app;

alter table settlement_batches add constraint settlement_batches_created_by_fkey foreign key (created_by) references users(id);
alter table settlement_batches add constraint settlement_batches_updated_by_fkey foreign key (updated_by) references users(id);
alter table settlement_lines add constraint settlement_lines_created_by_fkey foreign key (created_by) references users(id);
alter table settlement_lines add constraint settlement_lines_updated_by_fkey foreign key (updated_by) references users(id);
alter table settlement_lines add constraint settlement_lines_matched_by_fkey foreign key (matched_by) references users(id);

-- ----------------------------------------------------------------------------
-- Sanity checks to run manually after applying this file:
--
-- 1. RLS enabled:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname IN ('settlement_batches', 'settlement_lines');
-- -- should return zero rows.
-- ----------------------------------------------------------------------------
