-- ============================================================================
-- 0012_library.sql
--
-- Implements SRS v2.1 Chapter 28 (FR-OPS-010): "catalogue, circulation
-- (issue/return/renew/fine), member linkage to student/staff records."
-- Second of Chapter 28's five domains (after Discipline).
--
-- Scope notes (read before extending this):
--   - library_members reuses generated_documents' (0007) established
--     "typed nullable columns + one-non-null CHECK" polymorphic-source
--     pattern for the student/staff link, rather than an untyped
--     member_type/member_id pair — student_id is a real FK (students is
--     a real table); staff_user_id is not FK'd (no dedicated staff table
--     exists, same as every other actor-style column in this codebase).
--   - Fine calculation (returnLoan() in library.service.ts) uses a fixed
--     daily rate constant, not a configurable per-tenant policy — the
--     same class of simplification as Finance's fixed assistance
--     threshold before a real policy engine exists.
-- ============================================================================

create table library_items (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  title            text not null,
  author           text,
  isbn             text,
  category         text,
  total_copies     integer not null check (total_copies >= 0),
  available_copies integer not null check (available_copies >= 0),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  unique (tenant_id, id),
  constraint library_items_available_within_total check (available_copies <= total_copies)
);
create index idx_library_items_tenant on library_items (tenant_id);

alter table library_items enable row level security;
create policy tenant_isolation_library_items on library_items
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table library_members (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  student_id     uuid,   -- exactly one of these two is set — see header
  staff_user_id  uuid,   -- no FK: no dedicated staff table exists yet
  created_at     timestamptz not null default now(),
  created_by     uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id),
  constraint library_members_exactly_one_link check (
    (student_id is not null and staff_user_id is null) or
    (student_id is null and staff_user_id is not null)
  )
);
create index idx_library_members_tenant on library_members (tenant_id);

alter table library_members enable row level security;
create policy tenant_isolation_library_members on library_members
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table library_loans (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  item_id        uuid not null,
  member_id      uuid not null,
  issued_at      timestamptz not null default now(),
  due_date       date not null,
  returned_at    timestamptz,
  renewal_count  integer not null default 0,
  fine_amount    numeric(8, 2) not null default 0,
  fine_paid      boolean not null default false,
  status         text not null default 'on_loan' check (status in ('on_loan', 'returned')),
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, item_id) references library_items (tenant_id, id),
  foreign key (tenant_id, member_id) references library_members (tenant_id, id)
);
create index idx_library_loans_tenant on library_loans (tenant_id);
create index idx_library_loans_tenant_item on library_loans (tenant_id, item_id);
create index idx_library_loans_tenant_member on library_loans (tenant_id, member_id);

alter table library_loans enable row level security;
create policy tenant_isolation_library_loans on library_loans
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on library_items, library_members, library_loans to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
