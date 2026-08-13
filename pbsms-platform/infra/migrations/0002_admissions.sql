-- ============================================================================
-- 0002_admissions.sql
--
-- Implements SRS v2.1 Chapter 15 (Admissions Management, FR-ADM-010..050).
-- Per SRS v2.1 Chapter 44.3, admissions is the first module of "Phase 2 —
-- Academic Core," ahead of the academic-structure modules 0001 already
-- includes as its runnable RLS proof — this is the first *real* new
-- migration, and follows the exact pattern 0001's header comment requires
-- of it: tenant_id column, tenant_id-leading index, tenant-scoped unique
-- constraints, RLS enabled, and a grant to pbsms_app (never to the
-- migration/owner role — see 0001's "RESTRICTED APPLICATION ROLE" section
-- for why that distinction is load-bearing, not stylistic).
-- ============================================================================

create table applicants (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  school_id             uuid not null,
  first_name            text not null,
  last_name             text not null,
  dob                   date,
  gender                text,
  previous_school       text,
  -- FR-ADM: Draft -> Submitted -> Under Review -> {Documents Incomplete,
  -- Interview/Assessment Scheduled, Waitlisted, Approved, Rejected} ->
  -- Admitted, with Cancelled reachable from most active states. 'admitted'
  -- is only ever set by the convert() transaction below, never by a plain
  -- status update — see admissions.service.ts's ALLOWED_TRANSITIONS.
  status                text not null default 'draft'
                          check (status in ('draft','submitted','under_review','documents_incomplete',
                                             'interview_scheduled','waitlisted','approved','rejected',
                                             'admitted','cancelled')),
  -- FR-ADM-020: duplicates are surfaced for review, never auto-discarded —
  -- this column flags a possible match found at intake; nothing in this
  -- schema or service ever blocks or merges on it automatically.
  possible_duplicate_of uuid,
  -- FR-ADM-040: assigned only at conversion, never before, never reused.
  -- NULL for every applicant that hasn't converted yet; Postgres allows
  -- multiple NULLs under a unique constraint, so this coexists correctly
  -- with "unique per tenant" for the applicants that do have one.
  admission_no          text,
  -- Set by convert() once the student row exists — traceability from the
  -- applicant record back to the permanent student it became.
  student_id            uuid,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  deleted_at            timestamptz,
  deleted_by            uuid,
  unique (tenant_id, id),
  unique (tenant_id, admission_no),
  foreign key (tenant_id, school_id) references schools (tenant_id, id),
  foreign key (tenant_id, possible_duplicate_of) references applicants (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id)
);
create index idx_applicants_tenant on applicants (tenant_id);
create index idx_applicants_tenant_school on applicants (tenant_id, school_id);

alter table applicants enable row level security;
create policy tenant_isolation_applicants on applicants
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on applicants to pbsms_app;

-- ----------------------------------------------------------------------------
-- Sanity check (same one 0001 leaves as a comment — repeated here because a
-- migration that adds a tenant table without RLS should fail review
-- regardless of which file introduced it):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
