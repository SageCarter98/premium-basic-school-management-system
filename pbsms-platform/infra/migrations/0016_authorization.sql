-- ============================================================================
-- 0016_authorization.sql
--
-- Implements SRS v2.1 Chapter 13 (Roles, Responsibility, Authority & Scope)
-- and Chapter 33.2/33.3/33.6 (Authentication & Authorization / Segregation
-- of Duties / Data Protection & Monitoring) — Pass 1.
--
-- Scope notes (read before extending this):
--   - tenant_users.role_code already existed (0001_init_tenancy.sql) but was
--     read by nothing in the application — no guard, no JWT claim, no
--     module checked it. This migration doesn't add a role column; it adds
--     the machinery (login_lookup() returning role_codes, an audit log, a
--     rate-limit table, an MFA secret column) that the application-layer
--     RolesGuard (common/auth/roles.guard.ts) and AuthService need to make
--     role_code actually mean something.
--   - Only Chapter 13.2's role+tenant scope is covered here. Chapter 13.3's
--     full scope hierarchy (assigned students / linked children / record
--     ownership) is NOT — it depends on guardians and teacher-assignment
--     existing as real entities, which they don't yet (same gap
--     Discipline/Health/Communication's migrations already documented).
--   - login_attempts is NOT tenant-scoped and NOT RLS-protected: it exists
--     before any tenant is known (same reasoning as login_lookup() itself)
--     and is itself a security control, not tenant business data — same
--     category as platform_audit_logs.
--   - audit_log IS tenant-scoped and RLS'd like every other tenant-owned
--     table, but is deliberately append-only for the app role (SEC 33.6:
--     "Security and business audit events are append-only for ordinary
--     users") — pbsms_app gets INSERT and SELECT only, never UPDATE/DELETE.
-- ============================================================================

alter table users add column mfa_secret text;  -- base32 TOTP secret; set on enrol, used once mfa_enabled=true

-- ----------------------------------------------------------------------------
-- login_attempts (SEC-020: rate-limited login). Not tenant-scoped — see
-- header. email is stored lowercased by the caller (AuthService), matching
-- users' own case-insensitive unique index.
-- ----------------------------------------------------------------------------
create table login_attempts (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  succeeded    boolean not null,
  attempted_at timestamptz not null default now()
);
create index idx_login_attempts_email_time on login_attempts (email, attempted_at);

grant select, insert on login_attempts to pbsms_app;

-- ----------------------------------------------------------------------------
-- audit_log (SEC 33.6). One row per mutating (non-GET) request, written by
-- the global AuditLogInterceptor regardless of which module handled it —
-- this is a cross-cutting concern, not something each module opts into.
-- action uses Chapter 13.2's permission-action vocabulary where the request
-- maps cleanly onto one; falls back to the raw HTTP method otherwise.
-- ----------------------------------------------------------------------------
create table audit_log (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  actor_user_id   uuid not null,
  actor_role_codes text[] not null default array[]::text[],
  action          text not null,
  method          text not null,
  path            text not null,
  status_code     integer not null,
  detail          jsonb,
  created_at      timestamptz not null default now(),
  unique (tenant_id, id)
);
create index idx_audit_log_tenant on audit_log (tenant_id);
create index idx_audit_log_tenant_time on audit_log (tenant_id, created_at);

alter table audit_log enable row level security;
create policy tenant_isolation_audit_log on audit_log
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- Append-only for the app role: INSERT + SELECT only, no UPDATE/DELETE.
grant select, insert on audit_log to pbsms_app;

-- ----------------------------------------------------------------------------
-- login_lookup() must change shape (add mfa_enabled, mfa_secret, role_codes)
-- — CREATE OR REPLACE cannot change a function's return columns, so this is
-- an explicit drop + recreate. Re-grants EXECUTE to pbsms_app afterwards,
-- since the grant does not survive the drop.
-- ----------------------------------------------------------------------------
drop function if exists login_lookup(text);

create function login_lookup(p_email text)
returns table (
  user_id uuid,
  password_hash text,
  is_platform_user boolean,
  mfa_enabled boolean,
  mfa_secret text,
  tenant_id uuid,
  role_codes text[]
)
language sql
security definer
set search_path = public
as $$
  select
    u.id,
    u.password_hash,
    u.is_platform_user,
    u.mfa_enabled,
    u.mfa_secret,
    (select tu.tenant_id from tenant_users tu where tu.user_id = u.id limit 1) as tenant_id,
    coalesce(
      (select array_agg(distinct tu.role_code) from tenant_users tu where tu.user_id = u.id),
      array[]::text[]
    ) as role_codes
  from users u
  where lower(u.email) = lower(p_email)
  limit 1
$$;

revoke all on function login_lookup(text) from public;
grant execute on function login_lookup(text) to pbsms_app;

-- ----------------------------------------------------------------------------
-- auth_lookup_by_user_id(): the MFA-verify step (auth.module.ts's
-- verifyMfa()) only has a user id (from the short-lived MFA-challenge JWT
-- minted by login()), not an email, and — same reasoning as login_lookup()
-- itself — runs before any tenant context exists, so a plain query against
-- RLS-protected tenant_users would see nothing.
-- ----------------------------------------------------------------------------
create function auth_lookup_by_user_id(p_user_id uuid)
returns table (
  is_platform_user boolean,
  mfa_secret text,
  tenant_id uuid,
  role_codes text[]
)
language sql
security definer
set search_path = public
as $$
  select
    u.is_platform_user,
    u.mfa_secret,
    (select tu.tenant_id from tenant_users tu where tu.user_id = u.id limit 1) as tenant_id,
    coalesce(
      (select array_agg(distinct tu.role_code) from tenant_users tu where tu.user_id = u.id),
      array[]::text[]
    ) as role_codes
  from users u
  where u.id = p_user_id
$$;

revoke all on function auth_lookup_by_user_id(uuid) from public;
grant execute on function auth_lookup_by_user_id(uuid) to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one (audit_log is the
-- only new tenant-owned table here; login_attempts is deliberately excluded
-- from this check, same as platform_audit_logs/tenants/tenant_subscriptions/
-- plans, since it predates tenant resolution):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs','login_attempts');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
