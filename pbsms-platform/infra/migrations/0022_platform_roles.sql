-- ============================================================================
-- 0022_platform_roles.sql
--
-- Implements SRS v2.1 Chapter 3.1 (Platform Roles) and opens
-- tenant.middleware.ts's platform-role auth path — Phase A2 of the larger
-- Chapter 3-5 "Platform Foundation" initiative (A1 was
-- 0021_tenant_lifecycle.sql). Three things:
--
--   1. `platform_user_roles` — the role-code system Chapter 3.1's four
--      platform roles (Platform Super Admin, Support Engineer, Billing
--      Administrator, Onboarding Specialist) need. `users.is_platform_user`
--      (0001) only ever said yes/no; it never said WHICH platform role.
--      Not tenant-scoped (TEN-013: platform staff belong to no tenant), so
--      no RLS — same category as the other platform tables.
--
--   2. login_lookup()/auth_lookup_by_user_id() (0001/0016) both drop +
--      recreated again (CREATE OR REPLACE cannot change a function's
--      return columns, same reason 0016 already did this once) to add
--      `platform_role_codes` — a platform user's JWT needs to carry THEIR
--      role codes (from platform_user_roles), not the empty tenant
--      role_codes array every platform user has (they hold no
--      tenant_users row at all). auth.module.ts's login() now picks
--      platform_role_codes over role_codes when is_platform_user is true,
--      reusing the JWT's existing `roleCodes` field rather than adding a
--      second one — tenant.middleware.ts passes it into PlatformContextStore
--      for platform requests and TenantContextStore for tenant ones, same
--      field, different meaning depending on which kind of token it is.
--
--   3. `record_platform_action_in_tenant_audit()` — completes TEN-022
--      ("all platform-role actions against a tenant MUST be written to
--      both the platform audit log and that tenant's own audit log").
--      TenantsService (Phase A1) already writes platform_audit_logs; this
--      is the other half, found while building A2 rather than a separate
--      pass — `audit_log` (0016) is RLS'd and only pbsms_app has grants on
--      it, and pbsms_platform's connection never has app.current_tenant
--      set (these tables aren't tenant-scoped), so a SECURITY DEFINER
--      function is the same narrow-bypass pattern login_lookup() already
--      established, not a new mechanism.
--
-- TEN-020 ("platform roles MUST NOT be assignable to any user who is also
-- a member of a tenant") is enforced in modules/platform-staff/
-- platform-staff.service.ts's grantRole(), which needs to read
-- tenant_users to check — hence the extra grant below. The REVERSE check
-- (blocking a platform user from later being added to tenant_users) has
-- no write path to protect yet: creating/inviting tenant staff isn't
-- built either (staff.service.ts's own header notes this same gap) — flag
-- for whoever eventually builds that flow, not fixed here.
-- ============================================================================

create table platform_user_roles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id),
  role_code    text not null
                 check (role_code in ('platform_super_admin', 'support_engineer', 'billing_administrator', 'onboarding_specialist')),
  granted_at   timestamptz not null default now(),
  granted_by   uuid references users(id),
  revoked_at   timestamptz,
  revoked_by   uuid references users(id)
);
create index idx_platform_user_roles_user on platform_user_roles (user_id);

-- One ACTIVE grant of a given role per user — same partial-unique-index
-- shape as teacher_assignments' active-slot index; a past revoked grant
-- stays in history rather than being deleted or reused.
create unique index uq_platform_user_roles_active on platform_user_roles (user_id, role_code) where revoked_at is null;

grant select, insert, update on platform_user_roles to pbsms_platform;

-- ----------------------------------------------------------------------------
-- TEN-020 dual-membership check: is a user a member of ANY tenant?
--
-- A plain `grant select on tenant_users to pbsms_platform` looks
-- sufficient but is NOT: tenant_users has RLS (`tenant_id =
-- current_tenant_id()`), and pbsms_platform's connection never sets
-- app.current_tenant (rightly — platform operations aren't scoped to one
-- tenant). current_tenant_id() then reads NULL, the RLS predicate
-- `tenant_id = NULL` is never true, and the SELECT silently returns ZERO
-- rows regardless of the real answer — RLS filters silently, it does not
-- error, exactly the kind of gap this codebase's own audit_log
-- WITH-CHECK lesson already flagged elsewhere. Caught live: an initial
-- version of this migration only granted SELECT directly, and
-- platform-staff.service.ts's TEN-020 check passed for a deliberately
-- constructed dual-membership test user when it should have rejected —
-- fixed here with the same SECURITY DEFINER bypass login_lookup()
-- already established, before this migration was ever considered done.
-- ----------------------------------------------------------------------------
create function is_tenant_member(p_user_id uuid) returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(select 1 from tenant_users where user_id = p_user_id)
$$;

revoke all on function is_tenant_member(uuid) from public;
grant execute on function is_tenant_member(uuid) to pbsms_platform;

-- ----------------------------------------------------------------------------
-- TEN-022, second half: write into a specific tenant's own audit_log on
-- behalf of a platform action. Owned by the migration/owner role (pbsms),
-- which — as table owner — bypasses RLS regardless of caller; SECURITY
-- DEFINER makes it run with that owner's privileges no matter who calls
-- it, exposing exactly this one parameterized insert to pbsms_platform
-- rather than granting broad audit_log access.
-- ----------------------------------------------------------------------------
create function record_platform_action_in_tenant_audit(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_actor_role_codes text[],
  p_action text,
  p_method text,
  p_path text,
  p_status_code integer,
  p_detail jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into audit_log (tenant_id, actor_user_id, actor_role_codes, action, method, path, status_code, detail)
  values (p_tenant_id, p_actor_user_id, p_actor_role_codes, p_action, p_method, p_path, p_status_code, p_detail)
$$;

revoke all on function record_platform_action_in_tenant_audit(uuid, uuid, text[], text, text, text, integer, jsonb) from public;
grant execute on function record_platform_action_in_tenant_audit(uuid, uuid, text[], text, text, text, integer, jsonb) to pbsms_platform;

-- ----------------------------------------------------------------------------
-- login_lookup() / auth_lookup_by_user_id(): add platform_role_codes.
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
  role_codes text[],
  platform_role_codes text[]
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
    ) as role_codes,
    coalesce(
      (select array_agg(distinct pur.role_code) from platform_user_roles pur where pur.user_id = u.id and pur.revoked_at is null),
      array[]::text[]
    ) as platform_role_codes
  from users u
  where lower(u.email) = lower(p_email)
  limit 1
$$;

revoke all on function login_lookup(text) from public;
grant execute on function login_lookup(text) to pbsms_app;

drop function if exists auth_lookup_by_user_id(uuid);

create function auth_lookup_by_user_id(p_user_id uuid)
returns table (
  is_platform_user boolean,
  mfa_secret text,
  tenant_id uuid,
  role_codes text[],
  platform_role_codes text[]
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
    ) as role_codes,
    coalesce(
      (select array_agg(distinct pur.role_code) from platform_user_roles pur where pur.user_id = u.id and pur.revoked_at is null),
      array[]::text[]
    ) as platform_role_codes
  from users u
  where u.id = p_user_id
$$;

revoke all on function auth_lookup_by_user_id(uuid) from public;
grant execute on function auth_lookup_by_user_id(uuid) to pbsms_app;

-- ----------------------------------------------------------------------------
-- Sanity checks to run manually after applying this file:
--
-- 1. platform_user_roles has no RLS (correct — not tenant-scoped) and the
--    partial unique index is in place:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'platform_user_roles';
--
-- 2. pbsms_platform's grants are exactly what this file + 0021 intended:
-- SELECT table_name, privilege_type FROM information_schema.role_table_grants
-- WHERE grantee = 'pbsms_platform' ORDER BY 1, 2;
-- -- tenants (select/insert/update), plans (select), platform_audit_logs
-- -- (select/insert), users (select), platform_user_roles
-- -- (select/insert/update), tenant_users (select).
-- ----------------------------------------------------------------------------
