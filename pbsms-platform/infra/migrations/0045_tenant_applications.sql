-- ============================================================================
-- 0045_tenant_applications.sql
--
-- Closes "Tenant can sign up via login portal if new to apply and
-- Platform-Admin should be capable to accept tenant" — confirmed before
-- building this that no public onboarding endpoint existed anywhere;
-- every tenant to date was created by a platform admin via
-- POST /v1/platform/tenants (tenants.service.ts's create()).
--
-- Modeled directly on admissions' own applicant -> convert() shape
-- (0002_admissions.sql), not on jamming a new initial state into
-- tenants' own 7-state lifecycle machine (0021_tenant_lifecycle.sql) —
-- that machine models an EXISTING tenant's life, not "does a tenant exist
-- yet at all," the exact same reason `applicants` stays a separate table
-- from `students` rather than students gaining a 'prospective' status.
--
-- tenant_applications is NOT tenant-scoped, NOT RLS'd — same TEN-005
-- exemption category as tenants/plans/platform_audit_logs themselves
-- (there is no tenant yet for a pending application to belong to).
-- pbsms_app gets INSERT only (the public submit path — see
-- tenant-applications.controller.ts, added to tenant.middleware.ts's
-- PUBLIC_PATHS); pbsms_platform gets SELECT/UPDATE (platform review),
-- mirroring the same split-by-caller-role shape
-- 0043_guardian_access_requests.sql already established for the
-- equivalent problem one layer down (tenant-scoped instead of
-- platform-scoped).
-- ============================================================================

create table tenant_applications (
  id             uuid primary key default gen_random_uuid(),
  school_name    text not null,
  contact_name   text not null,
  contact_email  text not null,
  contact_phone  text,
  address        text,
  message        text,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  review_notes   text,
  -- Set only once approved — traceability from the application back to
  -- the real tenant it became, same role student_id plays on applicants.
  tenant_id      uuid references tenants(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

grant insert on tenant_applications to pbsms_app;
grant select, update on tenant_applications to pbsms_platform;

-- ----------------------------------------------------------------------------
-- create_tenant_admin_user(): approval's one genuinely new piece of
-- ground. pbsms_platform has SELECT-only on `users` and no grant at all
-- on `tenant_users` (0021/0022's own headers — a plain grant on an RLS'd
-- table is silently a no-op for a connection that never sets
-- app.current_tenant). Approving an application needs to INSERT into
-- both, plus password_reset_tokens, for a brand new tenant's first real
-- staff member — the exact "platform role writing into a tenant-scoped
-- table" problem is_tenant_member()/record_platform_action_in_tenant_
-- audit() already solved the read/write-adjacent versions of. Same fix:
-- one narrow, parameterized SECURITY DEFINER function, owned by the
-- migration/owner role (bypasses RLS as table owner), never a blanket
-- grant. Mirrors staff.service.ts's inviteStaff() exactly otherwise — a
-- real password_hash for an unusable random placeholder, a hashed
-- set-password token, the raw token returned to the CALLER (the platform
-- admin approving) exactly once, same "no email provider configured —
-- share the link yourself" posture.
-- ----------------------------------------------------------------------------
create or replace function create_tenant_admin_user(
  p_tenant_id uuid,
  p_email text,
  p_full_name text,
  p_password_hash text,
  p_role_code text,
  p_token_hash text,
  p_token_expires_minutes integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  insert into users (email, password_hash, full_name)
  values (p_email, p_password_hash, p_full_name)
  returning id into v_user_id;

  insert into tenant_users (tenant_id, user_id, role_code, created_by, updated_by)
  values (p_tenant_id, v_user_id, p_role_code, v_user_id, v_user_id);

  insert into password_reset_tokens (user_id, token_hash, expires_at)
  values (v_user_id, p_token_hash, now() + (p_token_expires_minutes || ' minutes')::interval);

  return v_user_id;
end;
$$;

revoke all on function create_tenant_admin_user(uuid, text, text, text, text, text, integer) from public;
grant execute on function create_tenant_admin_user(uuid, text, text, text, text, text, integer) to pbsms_platform;

-- ----------------------------------------------------------------------------
-- Sanity check — tenant_applications is deliberately on the SAME
-- exemption list as tenants/plans/platform_audit_logs/users/
-- login_attempts (see this migration's header for why), so it belongs on
-- the existing exclusion list, not treated as a missed-RLS tenant table:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs','users','login_attempts','tenant_applications');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
