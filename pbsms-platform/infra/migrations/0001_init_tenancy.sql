-- ============================================================================
-- 0001_init_tenancy.sql
--
-- Implements SRS v2.1 Chapter 1 (TEN-001..TEN-005), Chapter 2 (tenant
-- hierarchy), and Chapter 30 (mandatory common fields, Row-Level Security).
--
-- This is the single most important file in this repository. It is the
-- concrete implementation of the architecture decision in Chapter 1: shared
-- database, shared schema, tenant_id discriminator, enforced by PostgreSQL
-- Row-Level Security as a database-layer defence independent of whether the
-- application code remembers to filter by tenant.
--
-- Run order: this migration must run first. Every later migration that adds
-- a tenant-owned table MUST follow the same pattern shown below (tenant_id
-- column + RLS policy) or it violates NFR-SEC-010 and should fail review.
-- ============================================================================

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Session helper: reads the tenant_id the application set for this
-- connection/transaction. See apps/api/src/common/tenant/tenant.middleware.ts
-- for where this session variable is set on every request (TEN-004).
-- ----------------------------------------------------------------------------
create or replace function current_tenant_id() returns uuid as $$
  select nullif(current_setting('app.current_tenant', true), '')::uuid
$$ language sql stable;

-- ============================================================================
-- PLATFORM TABLES (exempt from tenant RLS — TEN-005)
-- These are restricted to platform-role database users only. Ordinary
-- tenant-scoped application connections should not be granted access to
-- these tables at all; enforce that via a separate DB role in production,
-- not shown here.
-- ============================================================================

create table plans (
  id                uuid primary key default gen_random_uuid(),
  code              text unique not null,               -- e.g. 'starter', 'standard', 'group', 'enterprise'
  name              text not null,
  billing_basis     text not null,                       -- 'flat' | 'per_active_student'
  created_at        timestamptz not null default now()
);

create table tenants (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text unique not null,
  status            text not null default 'trial'
                      check (status in ('trial','onboarding','active','past_due','suspended','offboarding','closed')),
  plan_id           uuid references plans(id),
  billing_email     text,
  country           text not null default 'GH',
  default_currency  text not null default 'GHS',
  default_timezone  text not null default 'Africa/Accra',
  created_at        timestamptz not null default now(),
  trial_ends_at     timestamptz,
  suspended_at      timestamptz
);

create table tenant_subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  plan_id               uuid not null references plans(id),
  billing_cycle         text not null default 'termly' check (billing_cycle in ('monthly','termly')),
  status                text not null default 'trial',
  current_period_start  date,
  current_period_end    date,
  created_at            timestamptz not null default now()
);

create table platform_audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid,             -- references a platform user; no FK to keep this table dependency-light
  tenant_id    uuid references tenants(id),  -- nullable: some platform actions are not tenant-specific
  action       text not null,
  detail       jsonb,
  created_at   timestamptz not null default now()
);

-- ============================================================================
-- TENANT-OWNED TABLES
-- Every table below follows the mandatory pattern from Chapter 30.2:
--   - tenant_id uuid not null references tenants(id)
--   - tenant_id indexed as the leading column
--   - every unique constraint is tenant-scoped
--   - RLS enabled with a USING (tenant_id = current_tenant_id()) policy
--   - created_at/updated_at/created_by/updated_by present
-- ============================================================================

create table schools (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  name          text not null,
  code          text not null,
  level_scope   text not null default 'nursery_to_jhs',
  address       text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  deleted_by    uuid,
  unique (tenant_id, code),
  unique (tenant_id, id) -- lets children below FK on (tenant_id, school_id), not just id
);
create index idx_schools_tenant on schools (tenant_id);

alter table schools enable row level security;
create policy tenant_isolation_schools on schools
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table campuses (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  school_id     uuid not null,
  name          text not null,
  address       text,
  is_main       boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  deleted_by    uuid,
  -- composite FK (not just school_id -> schools.id): stops a row from ever
  -- referencing a school belonging to a different tenant, which a plain FK
  -- plus RLS-on-each-table-individually would not catch.
  foreign key (tenant_id, school_id) references schools (tenant_id, id)
);
create index idx_campuses_tenant on campuses (tenant_id);

alter table campuses enable row level security;
create policy tenant_isolation_campuses on campuses
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  password_hash  text not null,               -- Argon2id, per SEC-020
  full_name      text not null,
  is_platform_user boolean not null default false,  -- TEN-013 / TEN-020: platform staff never also belong to a tenant
  mfa_enabled    boolean not null default false,     -- SEC-030
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- users is intentionally NOT tenant_id-scoped as a row itself: a user's tenant
-- membership lives in tenant_users below, because platform users (TEN-013)
-- belong to no tenant at all. Email uniqueness is global to keep login simple;
-- revisit if a future requirement needs the same email across two tenants.
create unique index idx_users_email on users (lower(email));

create table tenant_users (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  user_id     uuid not null references users(id),
  role_code   text not null,   -- e.g. 'proprietor','headmaster','accountant','teacher','parent','student', or a platform role code
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (tenant_id, user_id, role_code)
);
create index idx_tenant_users_tenant on tenant_users (tenant_id);

alter table tenant_users enable row level security;
create policy tenant_isolation_tenant_users on tenant_users
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- login_lookup(): the login flow (auth.module.ts) necessarily runs before
-- any tenant is known — that is what it exists to determine — so it cannot
-- SET app.current_tenant first. But tenant_users has RLS enabled above, and
-- pbsms_app (the restricted role the app connects as, see below) is not the
-- table owner, so a plain join against tenant_users from that role sees
-- ZERO rows with no tenant context set, for every user, always. This was
-- caught live: every login returned a token with tenantId: null regardless
-- of which real user logged in, which the tenant middleware then correctly
-- rejected — "Token carries no tenant" — the failure was loud, not silent,
-- but it meant login could never succeed for anyone.
--
-- The fix is this SECURITY DEFINER function: it is owned by the migration
-- role (pbsms), which — as the table owner — is exempt from RLS on these
-- tables, and SECURITY DEFINER makes it execute with the OWNER's
-- privileges no matter which role calls it. This exposes exactly one
-- narrow, parameterized read (find a user + their tenant membership by
-- email) to pbsms_app, instead of exempting the whole table from RLS or
-- granting pbsms_app a blanket bypass.
-- GRANT EXECUTE to pbsms_app happens later in this file, in the "RESTRICTED
-- APPLICATION ROLE" section — that role does not exist yet at this point.
create or replace function login_lookup(p_email text)
returns table (user_id uuid, password_hash text, is_platform_user boolean, tenant_id uuid)
language sql
security definer
set search_path = public
as $$
  select u.id, u.password_hash, u.is_platform_user, tu.tenant_id
  from users u
  left join tenant_users tu on tu.user_id = u.id
  where lower(u.email) = lower(p_email)
  limit 1
$$;

revoke all on function login_lookup(text) from public;

-- ----------------------------------------------------------------------------
-- students / enrolments — representative example from SRS Chapter 31.3,
-- included here (rather than deferred to a later migration) specifically so
-- this migration is a runnable, checkable proof of the RLS pattern end to
-- end, not just an abstract example.
-- ----------------------------------------------------------------------------

create table students (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  school_id      uuid not null,
  admission_no   text not null,
  first_name     text not null,
  last_name      text not null,
  dob            date,
  gender         text,
  status         text not null default 'active' check (status in ('active','transferred','withdrawn','graduated','archived')),
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  deleted_at     timestamptz,
  deleted_by     uuid,
  unique (tenant_id, admission_no),
  unique (tenant_id, id),
  foreign key (tenant_id, school_id) references schools (tenant_id, id)
);
create index idx_students_tenant on students (tenant_id);
create index idx_students_tenant_school on students (tenant_id, school_id);

alter table students enable row level security;
create policy tenant_isolation_students on students
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table academic_years (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  school_id   uuid not null,
  name        text not null,          -- e.g. '2026/2027'
  status      text not null default 'planned' check (status in ('planned','active','closed','archived')),
  start_date  date,
  end_date    date,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid,
  unique (tenant_id, school_id, name),
  unique (tenant_id, id),
  foreign key (tenant_id, school_id) references schools (tenant_id, id)
);
create index idx_academic_years_tenant on academic_years (tenant_id);

alter table academic_years enable row level security;
create policy tenant_isolation_academic_years on academic_years
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table classes (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  academic_year_id  uuid not null,
  name              text not null,      -- e.g. 'JHS 2A'
  level             text not null,      -- e.g. 'JHS 2'
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  deleted_at        timestamptz,
  deleted_by        uuid,
  unique (tenant_id, academic_year_id, name),
  unique (tenant_id, id),
  foreign key (tenant_id, academic_year_id) references academic_years (tenant_id, id)
);
create index idx_classes_tenant on classes (tenant_id);

alter table classes enable row level security;
create policy tenant_isolation_classes on classes
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table enrolments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  student_id        uuid not null,
  academic_year_id  uuid not null,
  class_id          uuid not null,
  status            text not null default 'active' check (status in ('active','closed','transferred')),
  start_date        date not null default current_date,
  end_date          date,
  closed_reason     text,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  deleted_at        timestamptz,
  deleted_by        uuid,
  unique (tenant_id, student_id, academic_year_id),  -- BR: one active enrolment per student per year (FR-STU rules)
  foreign key (tenant_id, student_id) references students (tenant_id, id),
  foreign key (tenant_id, academic_year_id) references academic_years (tenant_id, id),
  foreign key (tenant_id, class_id) references classes (tenant_id, id)
);
create index idx_enrolments_tenant on enrolments (tenant_id);
create index idx_enrolments_tenant_student on enrolments (tenant_id, student_id);

alter table enrolments enable row level security;
create policy tenant_isolation_enrolments on enrolments
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- ============================================================================
-- RESTRICTED APPLICATION ROLE (NFR-SEC-010)
--
-- CRITICAL: PostgreSQL table owners bypass row-level security by default,
-- even when RLS is "enabled" (this is documented Postgres behavior, not a
-- bug) — and this migration necessarily runs as the role that ends up
-- owning every table above. If the application connects using that same
-- (owner) role, every "ENABLE ROW LEVEL SECURITY" policy above is silently
-- inert: the app would see every tenant's rows regardless of
-- app.current_tenant. This was caught by actually running
-- test/tenant-isolation.e2e-spec.ts against a real database, not by
-- inspection — see the migration/seed role split in .env.example
-- (MIGRATE_DATABASE_URL vs DATABASE_URL) and confirm before trusting this
-- file again if either changes.
--
-- The fix is this role: the application (and the isolation test suite)
-- must connect as `pbsms_app`, never as the migration/owner role. Because
-- pbsms_app owns nothing and is not a superuser, RLS applies to it exactly
-- as written above, with no FORCE ROW LEVEL SECURITY needed (FORCE would
-- also apply to the owner, which would break plain seed/admin scripts that
-- don't set app.current_tenant — simpler to keep the owner as an
-- unrestricted migration/seed role and isolate via a second role instead).
--
-- Password is hardcoded here for the same reason `.env.example` hardcodes
-- `pbsms_local_only` — this is a local-dev/CI-only scaffold. Provision a
-- real secret through a secrets manager before this ever runs anywhere else.
-- ============================================================================

do $$
begin
  if not exists (select from pg_catalog.pg_roles where rolname = 'pbsms_app') then
    create role pbsms_app with login password 'pbsms_app_local_only';
  end if;
end
$$;

-- CONNECT and schema USAGE are both granted to PUBLIC by default in modern
-- Postgres, so pbsms_app already has them; only explicit table-level DML
-- needs granting. Deliberately excludes plans/tenants/tenant_subscriptions/
-- platform_audit_logs (TEN-005: platform tables are not reachable by
-- ordinary tenant-scoped application connections at all).
grant select, insert, update, delete on
  schools, campuses, users, tenant_users, students, academic_years, classes, enrolments
to pbsms_app;

-- EXECUTE on login_lookup() (defined above, just after tenant_users) — the
-- one deliberate, narrow RLS bypass this role gets, and only via a
-- SECURITY DEFINER function, never a blanket table grant.
grant execute on function login_lookup(text) to pbsms_app;

-- ----------------------------------------------------------------------------
-- Sanity checks the migration author should run manually after applying this
-- file:
--
-- 1. Confirm every table except the platform tables has RLS enabled
--    (users has no tenant_id column at all — identity shared across
--    tenant and platform contexts — so it's excluded here too):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs','users');
-- -- should return zero rows.
--
-- 2. Confirm isolation actually holds for the role the app really uses —
-- this is the check that catches the owner-bypass problem this section
-- fixes; the query above cannot catch it by itself:
-- \c pbsms pbsms_app
-- SET app.current_tenant = '11111111-1111-1111-1111-111111111111';
-- SELECT count(*) FROM students; -- must NOT include other tenants' rows
-- ----------------------------------------------------------------------------
