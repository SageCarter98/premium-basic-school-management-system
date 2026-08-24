-- ============================================================================
-- 0044_staff_feedback.sql
--
-- Closes the "individual role feedbacks should be forwarded to school
-- admin for review then either accept, reject or place on hold" gap from
-- the 2026-08-24 bug-list follow-up — confirmed via grep that nothing
-- resembling this existed anywhere in the codebase before this migration.
--
-- Ordinary tenant table, ordinary RLS, ordinary pbsms_app grant — unlike
-- 0043's guardian_access_requests, EVERY submitter here is already a real
-- authenticated tenant_users row (staff, not an anonymous public caller),
-- so there's no SECURITY DEFINER/public-path story needed; the normal
-- TenantDatabaseService + RLS path already covers it.
--
-- States: submitted -> accepted / rejected / on_hold, with on_hold
-- explicitly reopenable back to submitted — same "a workflow state needs
-- a way back or it's a dead end" lesson this codebase has already applied
-- repeatedly (results.reopen(), discipline's closed->investigating,
-- communication's reopened->in_progress). accepted/rejected are terminal
-- (matches admissions'/tenants' own "some states really are the end").
-- ============================================================================

create table staff_feedback (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  submitted_by   uuid not null references users(id),
  subject        text not null,
  message        text not null,
  status         text not null default 'submitted'
                   check (status in ('submitted', 'accepted', 'rejected', 'on_hold')),
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  admin_notes    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id)
);
create index idx_staff_feedback_tenant on staff_feedback (tenant_id);
create index idx_staff_feedback_tenant_status on staff_feedback (tenant_id, status);

alter table staff_feedback enable row level security;
create policy tenant_isolation_staff_feedback on staff_feedback
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update on staff_feedback to pbsms_app;
-- No delete grant — a triaged feedback item stays in the record
-- (same append-mostly posture discipline_cases/data_subject_requests use),
-- never silently removed once submitted.

-- ----------------------------------------------------------------------------
-- Sanity check (same one every migration adding a tenant table leaves):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs','users','login_attempts');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
