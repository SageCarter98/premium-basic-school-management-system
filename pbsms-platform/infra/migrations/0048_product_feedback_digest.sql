-- ============================================================================
-- 0048_product_feedback_digest.sql
--
-- Builds the actual scheduled job CLAUDE.md's Internal Engineering Agent
-- section names as the deliberate remaining gap after 0046/0047: EC-100/
-- EC-101 asks for a job, not just queries a human runs by hand. This
-- migration only adds the table + grants the job needs to write into;
-- the job itself (a new worker.ts loop + handler) is application code,
-- not SQL — see apps/api/src/jobs-worker/handlers/
-- product-feedback-digest.handler.ts.
--
-- Deliberately NOT reusing 0027_background_jobs.sql's background_jobs/
-- job_schedules queue: that queue is fundamentally per-tenant
-- (background_jobs.tenant_id not null, RLS'd, dequeue_next_job() always
-- runs a job scoped to exactly one tenant). Feedback clustering is the
-- opposite shape — one cross-tenant computation over ALL of
-- product_feedback, which itself has no tenant_id column at all (0046's
-- whole point). Forcing this into the tenant queue would be modeling it
-- wrong, not reusing infrastructure. So this is a platform-category
-- table, same class as product_feedback itself, and the job that writes
-- to it runs on its own timer in worker.ts rather than going through
-- background_jobs/job_schedules.
--
-- Each row is a full snapshot (all reports to date), not an incremental
-- delta — same "recompute the whole current picture" shape Chapter 14's
-- kpi_snapshots already established, and simpler than trying to merge
-- partial cluster results across runs. The job itself (not this
-- migration) skips writing a new row when nothing has changed since the
-- last one, so this table doesn't fill up with identical snapshots on a
-- quiet day.
--
-- Real ceiling, unchanged from 0047's own note: this still is not
-- semantic clustering, and EC-300's redaction of names/identifiers from
-- free text is still not solved here (or anywhere) — this job aggregates
-- exactly the same product_feedback content the runbook queries already
-- read, verbatim, for the same limited pbsms_platform-role audience. It
-- automates running the runbook, it doesn't change what's in scope for
-- redaction.
-- ============================================================================

create table product_feedback_digests (
  id                  uuid primary key default gen_random_uuid(),
  generated_at        timestamptz not null default now(),
  source_report_count integer not null, -- total product_feedback rows this snapshot covers
  new_report_count    integer not null, -- rows created since the previous digest (why this run happened at all)
  category_summary    jsonb not null,   -- runbook query 1: count/distinct_tenants/first_seen/last_seen per category
  role_summary        jsonb not null,   -- runbook query 2: report_count per (category, role_code)
  vocabulary          jsonb not null,   -- runbook query 3: top ts_stat words per category
  duplicate_clusters  jsonb not null,   -- runbook queries 4/5: pg_trgm connected groups per category
  created_at          timestamptz not null default now()
);
create index idx_product_feedback_digests_generated_at on product_feedback_digests (generated_at desc);

-- No RLS — platform-category table, same as product_feedback (no tenant_id
-- column, nothing to key a policy on).

-- pbsms_worker: read-only on the source table, write-only-in-practice on
-- the digest (the job only ever inserts, never updates/deletes a past
-- snapshot). Plain grants suffice here — unlike 0027's SECURITY DEFINER
-- functions, neither table is RLS'd, so there's no per-tenant bypass
-- problem to solve.
grant select on product_feedback to pbsms_worker;
grant select, insert on product_feedback_digests to pbsms_worker;

-- pbsms_platform: read access for the Engineering Lead (or a future
-- review UI), same shape as 0047's grant on product_feedback itself.
grant select on product_feedback_digests to pbsms_platform;

-- ----------------------------------------------------------------------------
-- Sanity check (same one every migration adding a non-RLS platform table
-- leaves):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs','users','login_attempts','platform_user_roles','impersonation_grants','impersonation_sensitive_approvals','platform_invoices','refresh_tokens','password_reset_tokens','data_inventory','retention_policies','data_breach_incidents','document_verify_attempts','revoked_sessions','guardian_access_request_attempts','tenant_applications','product_feedback','product_feedback_digests');
-- -- should still return zero rows after this file runs.
--
-- pbsms_worker should now have exactly: EXECUTE on the 3 queue functions
-- (0027), SELECT on product_feedback, SELECT+INSERT on
-- product_feedback_digests, and NOTHING else:
-- SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'pbsms_worker' ORDER BY table_name;
-- ----------------------------------------------------------------------------
