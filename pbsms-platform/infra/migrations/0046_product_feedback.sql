-- ============================================================================
-- 0046_product_feedback.sql
--
-- Builds the capture point the Internal Engineering Agent rulebook
-- (CLAUDE.md, PBSMS_Internal_Engineering_Agent_v1_1.pdf, EC-100/EC-101)
-- names as a prerequisite it doesn't have yet: a real channel for
-- feedback ABOUT THE PBSMS PRODUCT ITSELF, distinct from and never to be
-- confused with staff_feedback (0044) — that table is internal-to-one-
-- school (a teacher telling their own headmaster the photocopier is
-- broken), tenant-scoped, RLS'd, never meant to leave the tenant. This
-- table is the opposite shape on purpose: cross-tenant, anonymised at
-- write time, meant to reach the engineering backlog.
--
-- Platform-category table (no tenant_id column at all, not RLS'd) — same
-- exemption class as tenant_applications/document_verify_attempts, not a
-- tenant-owned table with a bug. EC-301 ("tenant attribution shall be by
-- opaque identifier only... shall not know which fourteen") is enforced
-- structurally, not by convention: tenant_ref is a one-way HMAC-SHA256 of
-- the real tenant_id (keyed on JWT_SECRET, computed application-side
-- before insert — see product-feedback.service.ts), and the real
-- tenant_id is never a column here at all. There is no query that can
-- recover it from this table alone.
--
-- Honest limitation, stated rather than silently assumed away: EC-300
-- also asks that student/guardian/staff names and identifiers be
-- stripped from feedback content before it reaches the Agent. That is a
-- named-entity-recognition problem for free text ("when scoring Ama
-- Mensah I got an error") — real NLP tooling, not something a migration
-- or a regex can honestly claim to solve. Not implemented here. The
-- submission form instructs the reporter not to include a student's or
-- guardian's name; nothing yet enforces that mechanically. Anyone
-- building the actual EC-100/101 clustering job that reads this table
-- needs to solve real redaction first, not treat the opaque tenant_ref
-- as if it were the whole anonymisation story.
-- ============================================================================

create table product_feedback (
  id          uuid primary key default gen_random_uuid(),
  tenant_ref  text not null, -- HMAC-SHA256(tenant_id), never the real id
  role_codes  text[] not null, -- the submitter's own roles, for EC-101's "affected roles" — never their user id or name
  category    text not null check (category in ('bug', 'feature_request', 'other')),
  subject     text not null,
  message     text not null,
  screen      text, -- optional: which screen/route they were on, client-supplied
  created_at  timestamptz not null default now()
);
create index idx_product_feedback_tenant_ref on product_feedback (tenant_ref);
create index idx_product_feedback_category on product_feedback (category);

-- No RLS — there is no tenant_id column to key a policy on, by design
-- (the whole point is this table is NOT tenant-scoped data).

-- Submit-only grant, same least-privilege shape tenant_applications' own
-- public-submit grant uses: pbsms_app can INSERT (any authenticated staff
-- member submitting from their own tenant-scoped session), nothing reads
-- it back through the app. No pbsms_platform grant yet either — there is
-- no review/clustering surface built to consume this table, deliberately
-- not built ahead of a real consumer (see this migration's header).
-- Reading it today means a human with MIGRATE_DATABASE_URL access
-- (the Engineering Lead) querying it directly.
grant insert on product_feedback to pbsms_app;

-- ----------------------------------------------------------------------------
-- Sanity check (same one every migration adding a tenant table leaves):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs','users','login_attempts','platform_user_roles','impersonation_grants','impersonation_sensitive_approvals','platform_invoices','refresh_tokens','password_reset_tokens','data_inventory','retention_policies','data_breach_incidents','document_verify_attempts','revoked_sessions','guardian_access_request_attempts','tenant_applications','product_feedback');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
