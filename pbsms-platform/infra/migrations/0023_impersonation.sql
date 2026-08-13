-- ============================================================================
-- 0023_impersonation.sql
--
-- Implements SRS v2.1 TEN-021/022 (Support Engineer impersonation of a
-- tenant's admin view) — Phase A3 of the Chapter 3-5 "Platform
-- Foundation" initiative (A1 = 0021, A2 = 0022).
--
-- Two platform tables (no RLS — TEN-005 category, same as
-- platform_user_roles):
--
--   impersonation_grants — one row per "Support Engineer X may act as
--   tenant Y's admin for up to 2 hours, against ticket Z". TEN-021's hard
--   cap ("MUST be time-boxed to a maximum of 2 hours per grant") is a
--   same-row CHECK constraint (expires_at <= granted_at + 2h) — legitimate
--   here, unlike most cross-row business rules in this codebase, because
--   both columns live on the one row being checked.
--
--   impersonation_sensitive_approvals — TEN-021's four-eyes requirement
--   ("MUST NOT permit financial reversal, data export, or permission
--   changes without a second platform approver"). requested_by/
--   approved_by distinctness is ALSO a same-row CHECK for the same
--   reason — unlike Financial Assistance's equivalent rule
--   (0009_finance_assistance.sql), which needed service-level enforcement
--   because it also carries role-tier logic this table doesn't.
--
-- Only 'financial_reversal' is wired to an actual guard in this pass
-- (common/auth/impersonation-sensitive-action.guard.ts, applied to
-- finance.controller.ts's two reversal endpoints) — 'data_export' and
-- 'permission_change' are real CHECK-constraint values so the mechanism
-- is complete, but neither has a live write path in this codebase yet
-- (TEN-025 export isn't built; tenant-side permission changes have no
-- API surface either) to actually gate. Not faked — the enum exists so
-- whoever builds those write paths later just adds the @SensitiveAction()
-- decorator, not a new table.
-- ============================================================================

create table impersonation_grants (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id),
  granted_to               uuid not null references users(id),
  support_ticket_ref       text not null,
  reason                   text,
  granted_by               uuid references users(id),
  granted_at               timestamptz not null default now(),
  expires_at               timestamptz not null,
  revoked_at               timestamptz,
  revoked_by               uuid references users(id),
  tenant_consent_captured  boolean not null default false,
  check (expires_at <= granted_at + interval '2 hours')
);
create index idx_impersonation_grants_tenant on impersonation_grants (tenant_id);
create index idx_impersonation_grants_granted_to on impersonation_grants (granted_to);

grant select, insert, update on impersonation_grants to pbsms_platform;

create table impersonation_sensitive_approvals (
  id            uuid primary key default gen_random_uuid(),
  grant_id      uuid not null references impersonation_grants(id),
  action_type   text not null check (action_type in ('financial_reversal', 'data_export', 'permission_change')),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by  uuid not null references users(id),
  requested_at  timestamptz not null default now(),
  approved_by   uuid references users(id),
  approved_at   timestamptz,
  consumed_at   timestamptz,
  check (approved_by is null or approved_by <> requested_by)
);
create index idx_impersonation_sensitive_approvals_grant on impersonation_sensitive_approvals (grant_id);

grant select, insert, update on impersonation_sensitive_approvals to pbsms_platform;

-- ----------------------------------------------------------------------------
-- Live-grant validation: tenant.middleware.ts checks an impersonation
-- token's grant is still active (not expired, not revoked) on EVERY
-- request, not just at token-mint time — a JWT-only expiry check would
-- miss a grant revoked mid-session, and TEN-021's "time-boxed... audited"
-- framing implies revocation should actually stop the session, not just
-- be visible after the fact. This is a plain SELECT against
-- impersonation_grants (a platform table pbsms_platform already has
-- SELECT on above) — no RLS-bypass function needed here, unlike
-- is_tenant_member() in 0022, because impersonation_grants isn't a
-- tenant-owned/RLS'd table.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Sanity checks to run manually after applying this file:
--
-- 1. Both new tables have no RLS (correct — platform tables):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname IN ('impersonation_grants', 'impersonation_sensitive_approvals');
-- -- should return exactly these 2 rows (both expected to lack RLS).
-- ----------------------------------------------------------------------------
