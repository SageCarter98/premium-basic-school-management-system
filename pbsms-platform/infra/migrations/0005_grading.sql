-- ============================================================================
-- 0005_grading.sql
--
-- Implements SRS v2.1 Chapter 20 (Enterprise Grading Engine, FR-GRA-010..070).
-- Per Chapter 44.3 this is the module after assessment (0004_assessment.sql),
-- which it reads from but never writes to (FR-GRA-010: "the engine never
-- collects scores directly").
--
-- Scope notes (read before extending this):
--   - FR-GRA-070 ("every published outcome retains the exact grading-policy
--     version used, permanently") is modelled by treating grading_policies
--     as create-once, mutate-never after leaving 'draft': there is no
--     policy-level "reopen", unlike assessment_structures. To correct an
--     active policy you retire it and create a new one (a new row, not a
--     new row version of the old one) and grading.service.ts's
--     activatePolicy() enforces that scale items are only addable while
--     status = 'draft'. result_candidates.grading_policy_id is then a
--     plain immutable FK — permanence falls out of the policy itself never
--     changing underneath it, not out of any special versioning machinery.
--   - FR-GRA-030 ("ranges MUST NOT overlap") is enforced at the DATABASE
--     level via an EXCLUDE constraint on grading_scale_items, the same
--     "don't just trust application code" instinct that makes tenant
--     isolation itself RLS-based rather than app-filtered (see
--     0001_init_tenancy.sql's header). This needs the btree_gist extension
--     for GiST support on the uuid equality term.
--     The other half of FR-GRA-030 ("or leave unintended gaps") is NOT
--     DB-enforceable the same way — contiguous coverage of [0,100] is a
--     cross-row arithmetic property, not a pairwise one — so that check
--     lives in grading.service.ts's activatePolicy(), the same "Postgres
--     CHECK/EXCLUDE can't see the whole row set, application code can"
--     reasoning 0004_assessment.sql's publish() documents for its own
--     weight-sum-to-100 check.
--   - result_candidates is the FR-GRA-040 pipeline's landing table
--     (approved scores -> totals -> percentage -> policy lookup -> grade
--     -> remark), NOT Chapter 21's Result entity (Draft/Submitted/
--     Returned/.../Published/Locked/Archived approval workflow). Results
--     Management is a future module that would consume rows from this
--     table; building that approval/publication state machine here would
--     be scope creep into Chapter 21, not Chapter 20.
--   - FR-GRA-050's ranking modes (competition/dense/none) are computed in
--     grading.service.ts's rank(), not as a DB concept — this table only
--     stores the resulting integer.
-- ============================================================================

create extension if not exists "btree_gist"; -- GiST support for the uuid equality term in the EXCLUDE constraint below

create table grading_policies (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  name           text not null,
  -- FR-GRA-020: developmental (Nursery/KG), numerical (Primary/JHS), or an
  -- opt-in NaCCA competency-based model — never altering historical
  -- outcomes graded under a different applicability, which is exactly why
  -- policies are immutable once active rather than editable in place.
  applicability  text not null check (applicability in ('developmental', 'numerical', 'nacca_competency')),
  version        integer not null default 1,
  status         text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  activated_at   timestamptz,
  retired_at     timestamptz,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  unique (tenant_id, id),
  unique (tenant_id, name, version)
);
create index idx_grading_policies_tenant on grading_policies (tenant_id);

alter table grading_policies enable row level security;
create policy tenant_isolation_grading_policies on grading_policies
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table grading_scale_items (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  grading_policy_id  uuid not null,
  -- FR-GRA-030: percentages, so bounded to [0, 100] regardless of the
  -- assessment structure's own component weighting — publish() in
  -- 0004_assessment.sql already guarantees a published structure's
  -- components sum to a 0-100 percentage.
  min_value          numeric(5, 2) not null check (min_value >= 0),
  max_value          numeric(5, 2) not null check (max_value <= 100),
  grade              text not null,
  point              numeric(4, 2),
  remark             text,
  is_pass            boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  check (min_value <= max_value),
  unique (tenant_id, id),
  unique (tenant_id, grading_policy_id, grade),
  foreign key (tenant_id, grading_policy_id) references grading_policies (tenant_id, id),
  -- FR-GRA-030's non-overlap rule, enforced by Postgres itself: two scale
  -- items on the same policy whose [min_value, max_value] ranges intersect
  -- at all fail this constraint on INSERT/UPDATE, not on some later
  -- application-level pass. `numrange(..., '[]')` makes both bounds
  -- inclusive, matching FR-GRA-030's "each scale item has minimum,
  -- maximum" wording literally (a boundary percentage belongs to exactly
  -- one band, decided by which items are defined, not by an implicit
  -- half-open convention).
  exclude using gist (
    grading_policy_id with =,
    numrange(min_value, max_value, '[]') with &&
  )
);
create index idx_grading_scale_items_tenant on grading_scale_items (tenant_id);
create index idx_grading_scale_items_tenant_policy on grading_scale_items (tenant_id, grading_policy_id);

alter table grading_scale_items enable row level security;
create policy tenant_isolation_grading_scale_items on grading_scale_items
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table result_candidates (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id),
  assessment_structure_id  uuid not null,
  student_id               uuid not null,
  grading_policy_id        uuid not null,
  -- FR-GRA-040: approved scores -> totals -> percentage -> policy lookup ->
  -- grade -> remark. percentage is the weighted sum computed in
  -- grading.service.ts (each component's value/max_score * weight,
  -- summed) — stored rather than recomputed on every read, since
  -- FR-GRA-070 requires the outcome to be reproducible against the exact
  -- policy version even if the underlying scores later change (a rescore
  -- after a reopen produces a new compute() call, not a live-recalculated
  -- view).
  percentage               numeric(5, 2) not null check (percentage >= 0 and percentage <= 100),
  grade                    text not null,
  point                    numeric(4, 2),
  remark                   text,
  is_pass                  boolean not null,
  -- FR-GRA-050: null when ranking is disabled (developmental policies, or
  -- mode = 'none') or not yet computed — never a fabricated "rank 1" for a
  -- single-student structure.
  rank                     integer,
  computed_at              timestamptz not null default now(),
  created_by               uuid,
  unique (tenant_id, id),
  -- One current outcome per structure+student — recompute() upserts
  -- (mirrors scores' unique constraint in 0004_assessment.sql), rather
  -- than accumulating a row per attempt. Retaining computation HISTORY
  -- (e.g. for audit) is a documented future enhancement, not built here.
  unique (tenant_id, assessment_structure_id, student_id),
  foreign key (tenant_id, assessment_structure_id) references assessment_structures (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id),
  foreign key (tenant_id, grading_policy_id) references grading_policies (tenant_id, id)
);
create index idx_result_candidates_tenant on result_candidates (tenant_id);
create index idx_result_candidates_tenant_structure on result_candidates (tenant_id, assessment_structure_id);

alter table result_candidates enable row level security;
create policy tenant_isolation_result_candidates on result_candidates
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on grading_policies, grading_scale_items, result_candidates to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
--
-- Extra sanity check specific to this migration — confirm the EXCLUDE
-- constraint actually rejects an overlapping range (run against a policy
-- that already has a 0-59 'F' band):
-- INSERT INTO grading_scale_items (tenant_id, grading_policy_id, min_value, max_value, grade)
--   VALUES (current_tenant_id(), '<policy id>', 50, 65, 'D');
-- -- should fail with: ERROR: conflicting key value violates exclusion constraint
-- ----------------------------------------------------------------------------
