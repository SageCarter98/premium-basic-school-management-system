-- ============================================================================
-- 0024_billing.sql
--
-- Implements SRS v2.1 Chapter 5 (Subscription, Billing & Metering) —
-- Phase A4, the last piece of the Chapter 3-5 "Platform Foundation"
-- initiative (A1=0021, A2=0022, A3=0023). Distinct from Chapter 24
-- (Finance): this chapter is how PBSMS the company is paid BY schools,
-- not how a school bills its own parents.
--
-- Pricing columns on `plans` are added with illustrative, clearly-
-- documented placeholder values, per 5.1's own caveat: "confirm pricing
-- with the business before build." Configurable (real columns, not a
-- hardcoded constant), not final.
--
-- tenant_subscriptions (0001) already existed with a free-text `status`
-- column and no active-slot constraint — never actually used by any
-- service until now. Gets the same active/ended partial-unique-index
-- shape as teacher_assignments (0020): one ACTIVE subscription per
-- tenant, prior ones kept as history, never deleted.
--
-- Two SECURITY DEFINER functions, same bypass pattern as
-- is_tenant_member() (0022) and login_lookup() (0001) — NOT a plain
-- grant, per this codebase's own hard-learned lesson (see
-- feedback_pbsms_module_pattern memory, or 0022's is_tenant_member()
-- header, for why a plain grant against an RLS'd table silently does
-- nothing for a connection that never sets app.current_tenant):
--   count_active_students(p_tenant_id) — TEN-030's metered-usage count,
--     for pbsms_platform (billing.service.ts's generateInvoice()) to read
--     tenant-owned enrolments/academic_years/students data.
--   tenant_billing_summary() — TEN-031's "MUST make the current count and
--     the resulting projected bill visible to the tenant's Proprietor/
--     Administrator role at any time." Deliberately takes NO tenant_id
--     parameter — it reads current_tenant_id() (the RLS session variable
--     TenantDatabaseService already sets), so a tenant's own request can
--     only ever see ITS OWN billing summary, never another tenant's by
--     passing a different id. Exposed to pbsms_app (not pbsms_platform —
--     this is the ordinary tenant-facing half of Chapter 5).
--
-- TEN-030's "active student" definition doesn't map cleanly onto this
-- schema's actual vocabulary (no `students.status` enum with
-- suspended/withdrawn/graduated/archived values — only
-- `enrolments.status` and `students.deleted_at`) — count_active_students()
-- uses "a non-deleted student with an enrolment in status='active'
-- against an academic_year in status='active'" as the practical mapping,
-- a documented modeling decision, same as every other "schema doesn't
-- have the exact SRS vocabulary yet" gap already in this codebase.
-- ============================================================================

alter table plans add column flat_fee_amount numeric(10, 2);
alter table plans add column per_student_rate numeric(10, 2);
alter table plans add column currency text not null default 'GHS';
alter table plans add constraint plans_pricing_matches_basis check (
  (billing_basis = 'flat' and flat_fee_amount is not null)
  or (billing_basis = 'per_active_student' and per_student_rate is not null)
);

alter table tenant_subscriptions add column ended_at timestamptz;
alter table tenant_subscriptions add column created_by uuid references users(id);
alter table tenant_subscriptions alter column status set default 'active';
alter table tenant_subscriptions add constraint tenant_subscriptions_status_check check (status in ('active', 'ended'));
create unique index uq_tenant_subscriptions_active on tenant_subscriptions (tenant_id) where status = 'active';

create table platform_invoices (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  tenant_subscription_id uuid not null references tenant_subscriptions(id),
  billing_cycle         text not null check (billing_cycle in ('monthly', 'termly')),
  period_start          date not null,
  period_end            date not null,
  active_student_count  integer not null check (active_student_count >= 0),
  plan_code             text not null,
  amount                numeric(10, 2) not null check (amount >= 0),
  currency              text not null default 'GHS',
  status                text not null default 'issued' check (status in ('issued', 'paid', 'overdue', 'cancelled')),
  payment_method        text check (payment_method in ('bank_transfer')),  -- card/mobile_money rejected, same as finance.service.ts's recordPayment()
  payment_reference     text,
  issued_at             timestamptz not null default now(),
  paid_at               timestamptz,
  created_by            uuid references users(id)
);
create index idx_platform_invoices_tenant on platform_invoices (tenant_id);

grant select, insert, update on tenant_subscriptions to pbsms_platform;
grant select, insert, update on platform_invoices to pbsms_platform;

create function count_active_students(p_tenant_id uuid) returns integer
language sql
security definer
set search_path = public
as $$
  select count(distinct e.student_id)::integer
  from enrolments e
  join academic_years ay on ay.id = e.academic_year_id
  join students s on s.id = e.student_id
  where e.tenant_id = p_tenant_id
    and e.status = 'active'
    and ay.status = 'active'
    and s.deleted_at is null
$$;

revoke all on function count_active_students(uuid) from public;
grant execute on function count_active_students(uuid) to pbsms_platform;

create function tenant_billing_summary() returns table (
  plan_code text,
  billing_cycle text,
  currency text,
  flat_fee_amount numeric,
  per_student_rate numeric,
  active_student_count integer,
  projected_amount numeric,
  subscription_status text,
  current_period_start date,
  current_period_end date
)
language sql
security definer
set search_path = public
as $$
  select
    p.code,
    ts.billing_cycle,
    p.currency,
    p.flat_fee_amount,
    p.per_student_rate,
    count_active_students(current_tenant_id()),
    case
      when p.billing_basis = 'flat' then p.flat_fee_amount
      else p.per_student_rate * count_active_students(current_tenant_id())
    end,
    ts.status,
    ts.current_period_start,
    ts.current_period_end
  from tenant_subscriptions ts
  join plans p on p.id = ts.plan_id
  where ts.tenant_id = current_tenant_id() and ts.status = 'active'
$$;

revoke all on function tenant_billing_summary() from public;
grant execute on function tenant_billing_summary() to pbsms_app;

-- ----------------------------------------------------------------------------
-- Sanity checks to run manually after applying this file:
--
-- 1. platform_invoices has no RLS (platform table):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname = 'platform_invoices';
--
-- 2. tenant_billing_summary() only ever returns the CALLER's own tenant's
--    row regardless of anything a client could pass (it takes no
--    parameters at all) — the isolation guarantee here is structural, not
--    just tested.
-- ----------------------------------------------------------------------------
