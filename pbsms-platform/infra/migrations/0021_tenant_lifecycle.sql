-- ============================================================================
-- 0021_tenant_lifecycle.sql
--
-- Implements SRS v2.1 Chapter 4.1 (tenant lifecycle state machine,
-- TEN-023..026). This is the first migration to touch the PLATFORM TABLES
-- section of 0001_init_tenancy.sql (`tenants`, `plans`, `platform_audit_logs`)
-- since that file created them — those tables already carry the right
-- shape (tenants.status already has the exact 7-value CHECK constraint
-- this chapter names), but TEN-005 deliberately left them unreachable by
-- any application connection: `pbsms_app` (the role the running API uses
-- for every tenant-owned table) has ZERO grants on any platform table,
-- and 0001's own comment flags the missing role as "enforce via a
-- separate DB role in production, not shown here." This migration is
-- that role.
--
-- pbsms_platform is the mirror of pbsms_app (0001's "RESTRICTED
-- APPLICATION ROLE" section) for platform-level operations: a real,
-- narrowly-scoped, non-owner login role, used ONLY by
-- modules/tenants/tenants.service.ts (via the new PLATFORM_POOL provider
-- in database.module.ts), never by ordinary tenant-scoped request
-- handling. It does NOT get RLS treatment — TEN-005 exempts these tables
-- from tenant_id scoping entirely; the isolation boundary here is which
-- DB role can connect at all, not a USING policy.
--
-- Scope notes (read before extending this):
--   - No new columns on `tenants` — trial_ends_at/suspended_at already
--     exist from 0001 and are suffient for this pass; every transition
--     (not just the current state) is captured by inserting a
--     `platform_audit_logs` row (action='tenant_status_transition',
--     detail={fromStatus,toStatus,reason,...}), which is a STRONGER audit
--     trail than a handful of extra timestamp columns on `tenants` itself
--     would be (TEN-023..026 all say "every transition MUST be audited",
--     not just the current one).
--   - TEN-023's "a plan is selected and a billing method is confirmed"
--     gate is enforced in tenants.service.ts's transition() as an
--     explicit caller-supplied flag (billingMethodConfirmed /
--     freeTierApprovalReason), NOT a persisted "billing method" entity —
--     that belongs to Chapter 5 (subscription/billing), a later, separate
--     item in this same Phase A. This migration only builds the lifecycle
--     gate, not what sits behind it.
--   - No controller/HTTP surface lands with this migration. tenant_users
--     already can't be a platform user AND a tenant member gets enforced
--     later (TEN-020, a Phase A2 item) — until a real platform-role JWT
--     path exists (tenant.middleware.ts currently hard-refuses every
--     isPlatformUser request), there is no authenticated actor to safely
--     accept this service's calls from over HTTP.
-- ============================================================================

do $$
begin
  if not exists (select from pg_catalog.pg_roles where rolname = 'pbsms_platform') then
    create role pbsms_platform with login password 'pbsms_platform_local_only';
  end if;
end
$$;

-- Deliberately narrow: no DELETE anywhere (TEN-026's permanent deletion is
-- a retention-schedule-driven job, Chapter 40, not a direct app operation
-- against this connection), no write access to tenant_subscriptions here
-- (Chapter 5 / a later Phase A item), no access whatsoever to any
-- tenant-owned table (pbsms_platform has no more business reading a
-- tenant's students/invoices than pbsms_app has reading the tenant
-- registry — TEN-012's cross-tenant prohibition applies to platform-role
-- access too, scoped narrowly per TEN-021/022, not granted wholesale here).
grant select, insert, update on tenants to pbsms_platform;
grant select on plans to pbsms_platform;
grant select, insert on platform_audit_logs to pbsms_platform;

-- `users` is not itself a TEN-005 platform table (it holds tenant staff
-- identities too, via tenant_users), but platform staff also live here
-- (is_platform_user=true, no tenant_users row — TEN-013) and
-- tenants.service.ts needs to validate an actorId is a real platform user
-- before trusting it, same "don't accept any UUID blindly" principle
-- staff.service.ts/guardians.service.ts already apply elsewhere. Read-only:
-- creating/inviting platform staff is a Phase A2 item (real platform role
-- codes — Chapter 3.1 — don't exist yet, just this one boolean).
grant select on users to pbsms_platform;

-- ----------------------------------------------------------------------------
-- Sanity checks to run manually after applying this file:
--
-- 1. pbsms_platform can reach exactly the three platform tables, nothing else:
-- SELECT table_name, privilege_type FROM information_schema.role_table_grants
-- WHERE grantee = 'pbsms_platform' ORDER BY 1, 2;
-- -- should show only tenants (SELECT/INSERT/UPDATE), plans (SELECT),
-- -- platform_audit_logs (SELECT/INSERT).
--
-- 2. pbsms_app still has NO grants on any platform table (TEN-005 intact):
-- SELECT table_name FROM information_schema.role_table_grants
-- WHERE grantee = 'pbsms_app' AND table_name IN ('tenants','plans','tenant_subscriptions','platform_audit_logs');
-- -- should return zero rows.
-- ----------------------------------------------------------------------------
