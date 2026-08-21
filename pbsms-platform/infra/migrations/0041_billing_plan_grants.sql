-- ============================================================================
-- 0041_billing_plan_grants.sql
--
-- Fixes a real gap found live-testing 0037-0040's own sibling pass (billing
-- plan CRUD, billing.service.ts's createPlan()/updatePlan()): 0021_tenant_
-- lifecycle.sql only ever granted pbsms_platform SELECT on `plans` — correct
-- at the time, since plans were genuinely read-only until this pass. Neither
-- 0024_billing.sql (which added the pricing columns) nor the uncommitted
-- createPlan()/updatePlan() work that follows it added the INSERT/UPDATE
-- grant those new write paths actually need, so both endpoints 500'd with a
-- raw Postgres "permission denied for table plans" (42501) — confirmed via
-- live-HTTP testing as platform_super_admin, not a hypothetical.
-- ============================================================================

grant insert, update on plans to pbsms_platform;
