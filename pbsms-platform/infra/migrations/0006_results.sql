-- ============================================================================
-- 0006_results.sql
--
-- Implements SRS v2.1 Chapter 21 (Results Management Engine, FR-RES-010..050).
-- Per Chapter 44.3 this is the module after grading (0005_grading.sql),
-- which it reads from (result_candidates) but never recomputes — a
-- student_result is a compiled, versioned BUNDLE of a student's
-- already-graded subjects for one class+academic year, taken through an
-- approval workflow to publication.
--
-- Scope notes (read before extending this):
--   - FR-RES-010's nine states map to explicit methods in results.service.ts
--     (submit/return/correct/review/approve/publish/lock/archive), not a
--     generic table-driven transition map like admissions.service.ts's
--     ALLOWED_TRANSITIONS — each transition here has distinct side-effect
--     columns (a mandatory reason on return, a distinct actor/timestamp
--     pair on every step), which reads more clearly as named methods.
--     21.1's workflow ("Subject Teacher -> Class Teacher -> optional
--     Academic Coordinator/Examination Officer -> Headmaster") is modelled
--     as submitted -> reviewed -> approved OR submitted -> approved
--     directly (the coordinator/officer step is optional, per the chapter
--     text) — there is no separate configurable "approval steps" table;
--     Chapter 13 permission enforcement (who is ALLOWED to call review()
--     vs approve()) is the same deferred Phase 1 item it is everywhere
--     else in this codebase.
--   - FR-RES-030 ("published results are never overwritten... recalculation
--     creates a new version while preserving the previous publication") is
--     why this is NOT assessment_structures' in-place reopen pattern.
--     reopen() (results.service.ts) instead INSERTs a new student_results
--     row (version+1, status 'draft', previous_version_id pointing at the
--     row it supersedes) and sets the old row's superseded_at — the old
--     row's own status/published_at/etc. are never touched again. The
--     partial unique index below (`where superseded_at is null`) makes
--     "at most one current version per student+class+year" a DATABASE
--     guarantee, the same "don't just trust application code" instinct
--     0005_grading.sql's EXCLUDE constraint documents for its own
--     cross-row rule.
--   - student_result_items is a SNAPSHOT of relevant result_candidates
--     fields at create()/resync() time, not a live join. grading.compute()
--     can be re-run against a structure at any point (it upserts
--     result_candidates), which would silently change an already-published
--     student_result's displayed grades if this table just referenced
--     result_candidates directly — exactly what FR-RES-030 forbids.
--     resync() (draft/returned/corrected only) is the explicit, visible
--     action that pulls in the latest result_candidates; publish() never
--     does this implicitly.
--   - FR-RES-020's "required subjects resolved or formally exempted" is
--     simplified to: every assessment_structures row with status
--     'published' for this student_result's (class_id, academic_year_id)
--     must have a corresponding student_result_items row before publish()
--     succeeds. There is no separate subject-requirement catalogue or a
--     formal per-student exemption flag (both would need Chapter 17's
--     still-unbuilt academic hierarchy, same gap 0004_assessment.sql's
--     header already notes for FR-ASM-020). "Term/publication windows
--     valid" and "an applicable report template available" are not
--     checked at all here — the former needs a Term concept this schema
--     doesn't have yet, the latter is Chapter 22 (Document Engine)
--     territory, a later module.
--   - average_percentage/subjects_failed_count/overall_pass are a
--     deliberately simple aggregate (overall_pass = zero failed subjects)
--     computed at snapshot time, NOT the BECE-aggregate-of-best-six
--     division-classification scoring Chapter 41 describes for JHS —
--     that is a distinct, more specialised calculation, documented here
--     as future scope rather than approximated.
-- ============================================================================

create table student_results (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  student_id             uuid not null,
  class_id               uuid not null,
  academic_year_id       uuid not null,
  -- FR-RES-030: version identifies this row within its student+class+year
  -- "family"; previous_version_id chains it to the version it supersedes.
  version                integer not null default 1,
  previous_version_id    uuid,
  status                 text not null default 'draft'
                           check (status in ('draft', 'submitted', 'returned', 'corrected', 'reviewed', 'approved', 'published', 'locked', 'archived')),
  submitted_at           timestamptz,
  submitted_by           uuid,
  returned_at            timestamptz,
  returned_by            uuid,
  return_reason          text,
  corrected_at           timestamptz,
  corrected_by           uuid,
  reviewed_at            timestamptz,
  reviewed_by            uuid,
  approved_at            timestamptz,
  approved_by            uuid,
  published_at           timestamptz,
  published_by           uuid,
  locked_at              timestamptz,
  locked_by              uuid,
  archived_at            timestamptz,
  archived_by            uuid,
  -- FR-RES-030: set on the NEW version explaining why it was created, not
  -- on the old one (see superseded_at below for the old row's own marker).
  reopened_at            timestamptz,
  reopened_by            uuid,
  reopen_reason          text,
  -- Set on the OLD row the moment a reopen() creates a newer version from
  -- it. A published/locked row's status/published_at/etc. are otherwise
  -- never modified again — this column is the only thing that changes on
  -- it post-publication, and it changes exactly once.
  superseded_at          timestamptz,
  average_percentage     numeric(5, 2),
  subjects_failed_count  integer not null default 0,
  overall_pass           boolean,
  created_at             timestamptz not null default now(),
  created_by             uuid,
  updated_at             timestamptz not null default now(),
  updated_by             uuid,
  unique (tenant_id, id),
  unique (tenant_id, student_id, class_id, academic_year_id, version),
  foreign key (tenant_id, student_id) references students (tenant_id, id),
  foreign key (tenant_id, class_id) references classes (tenant_id, id),
  foreign key (tenant_id, academic_year_id) references academic_years (tenant_id, id),
  foreign key (tenant_id, previous_version_id) references student_results (tenant_id, id)
);
create index idx_student_results_tenant on student_results (tenant_id);
create index idx_student_results_tenant_class_year on student_results (tenant_id, class_id, academic_year_id);

-- FR-RES-030's "at most one current version" guarantee, enforced by
-- Postgres rather than trusting reopen()/create() to get it right every
-- time: a second INSERT for the same student+class+year with
-- superseded_at still null fails this constraint, not just a service-level
-- check.
create unique index idx_student_results_one_current
  on student_results (tenant_id, student_id, class_id, academic_year_id)
  where superseded_at is null;

alter table student_results enable row level security;
create policy tenant_isolation_student_results on student_results
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table student_result_items (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id),
  student_result_id         uuid not null,
  subject_id                uuid not null,
  -- Snapshotted, not joined live — see this migration's header. A
  -- subject's own `name` could be edited after this row is written;
  -- deliberately not kept in sync with that.
  subject_name              text not null,
  grading_policy_id         uuid not null,
  percentage                numeric(5, 2) not null,
  grade                     text not null,
  point                     numeric(4, 2),
  remark                    text,
  is_pass                   boolean not null,
  -- Traceability only — never read back to detect drift; that would
  -- defeat the point of snapshotting.
  source_result_candidate_id uuid,
  created_at                timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, student_result_id, subject_id),
  foreign key (tenant_id, student_result_id) references student_results (tenant_id, id),
  foreign key (tenant_id, subject_id) references subjects (tenant_id, id),
  foreign key (tenant_id, grading_policy_id) references grading_policies (tenant_id, id),
  foreign key (tenant_id, source_result_candidate_id) references result_candidates (tenant_id, id)
);
create index idx_student_result_items_tenant on student_result_items (tenant_id);
create index idx_student_result_items_tenant_result on student_result_items (tenant_id, student_result_id);

alter table student_result_items enable row level security;
create policy tenant_isolation_student_result_items on student_result_items
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on student_results, student_result_items to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
--
-- Extra sanity check specific to this migration — confirm the partial
-- unique index actually rejects a second concurrent "current" version:
-- INSERT INTO student_results (tenant_id, student_id, class_id, academic_year_id, version)
--   VALUES (current_tenant_id(), '<student id>', '<class id>', '<year id>', 2);
-- -- against a student+class+year that already has a non-superseded row —
-- -- should fail with: ERROR: duplicate key value violates unique constraint
-- -- "idx_student_results_one_current"
-- ----------------------------------------------------------------------------
