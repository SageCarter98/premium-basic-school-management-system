-- ============================================================================
-- 0004_assessment.sql
--
-- Implements SRS v2.1 Chapter 19 (Assessment Management, FR-ASM-010..050).
-- Per Chapter 44.3 this is the module after admissions/student-lifecycle/
-- academic-structure/attendance.
--
-- Scope notes (read before extending this):
--   - FR-ASM-010 says assessment *types* are "configurable." This
--     migration hard-codes the five types the chapter itself enumerates
--     (class_exercise, homework, project, mid_term, end_of_term_exam) via
--     a CHECK constraint, the same pragmatic choice 0001/0002/0003 made
--     for their own status enums. True per-tenant custom types are a
--     future enhancement, not built here.
--   - FR-ASM-020 (restrict score entry to teachers with an active
--     assignment for that class subject) needs a teacher-assignment
--     concept that doesn't exist in this schema yet (Chapter 17's academic
--     hierarchy — Term, Class Subjects, Teacher Assignments — is only
--     partially built: this migration adds `subjects`, not the rest).
--     Left as a Phase 1 permission item, same deferral as every other
--     module's Chapter 13 enforcement.
--   - FR-ASM-040 ("lock submitted and published data until a controlled,
--     audited reopening") is modelled here as a single structure-level
--     status (draft -> published -> draft-via-reopen) rather than
--     separate submitted/published states, since there is no separate
--     "submission" workflow built yet (that is closer to Chapter 21,
--     Results Management). Scores are only enterable while their
--     structure is 'draft'.
-- ============================================================================

create table subjects (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  name          text not null,
  code          text not null,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  deleted_by    uuid,
  unique (tenant_id, id),
  unique (tenant_id, code)
);
create index idx_subjects_tenant on subjects (tenant_id);

alter table subjects enable row level security;
create policy tenant_isolation_subjects on subjects
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- One assessment_structures row = the weighted "recipe" for how a class's
-- subject is assessed in a given academic year (FR-ASM-010). Components
-- (below) hold the actual weighted line items.
create table assessment_structures (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  class_id          uuid not null,
  subject_id        uuid not null,
  academic_year_id  uuid not null,
  -- FR-ASM-040: published data is locked; reopening is controlled and
  -- audited (reopened_at/by/reason below), never a silent status flip.
  status            text not null default 'draft' check (status in ('draft', 'published')),
  published_at      timestamptz,
  reopened_at       timestamptz,
  reopened_by       uuid,
  reopen_reason     text,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  deleted_at        timestamptz,
  deleted_by        uuid,
  unique (tenant_id, id),
  -- One structure per class+subject+year — FR-ASM-010's weighting rule is
  -- meaningless if two competing structures could exist for the same slot.
  unique (tenant_id, class_id, subject_id, academic_year_id),
  foreign key (tenant_id, class_id) references classes (tenant_id, id),
  foreign key (tenant_id, subject_id) references subjects (tenant_id, id),
  foreign key (tenant_id, academic_year_id) references academic_years (tenant_id, id)
);
create index idx_assessment_structures_tenant on assessment_structures (tenant_id);

alter table assessment_structures enable row level security;
create policy tenant_isolation_assessment_structures on assessment_structures
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table assessment_components (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  assessment_structure_id uuid not null,
  component_type          text not null
                            check (component_type in ('class_exercise', 'homework', 'project', 'mid_term', 'end_of_term_exam')),
  -- FR-ASM-010: weights across a structure's components must sum to
  -- exactly 100 before that structure can be published — enforced in
  -- assessment.service.ts's publish(), not by a CHECK constraint, since
  -- Postgres CHECK constraints cannot reference sibling rows.
  weight                  numeric(5, 2) not null check (weight > 0 and weight <= 100),
  -- FR-ASM-030: configured score bounds.
  max_score               numeric(6, 2) not null default 100 check (max_score > 0),
  -- FR-ASM-050: optional NaCCA tagging for schools that opt into
  -- curriculum-aligned reporting (Chapter 41) — a placeholder column, not
  -- the full NaCCA strand/sub-strand model, which is out of scope here.
  nacca_strand            text,
  created_at              timestamptz not null default now(),
  created_by              uuid,
  updated_at              timestamptz not null default now(),
  updated_by              uuid,
  unique (tenant_id, id),
  unique (tenant_id, assessment_structure_id, component_type),
  foreign key (tenant_id, assessment_structure_id) references assessment_structures (tenant_id, id)
);
create index idx_assessment_components_tenant on assessment_components (tenant_id);
create index idx_assessment_components_tenant_structure on assessment_components (tenant_id, assessment_structure_id);

alter table assessment_components enable row level security;
create policy tenant_isolation_assessment_components on assessment_components
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table scores (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  assessment_component_id uuid not null,
  student_id              uuid not null,
  -- FR-ASM-030: a score is either a value within [0, component.max_score]
  -- (checked in application code, since the bound is per-component, not a
  -- fixed constant) or explicitly marked missing with a reason — never
  -- both null and unexplained.
  value                   numeric(6, 2),
  status                  text not null default 'scored' check (status in ('scored', 'missing')),
  missing_reason          text,
  created_at              timestamptz not null default now(),
  created_by              uuid,
  updated_at              timestamptz not null default now(),
  updated_by              uuid,
  unique (tenant_id, id),
  unique (tenant_id, assessment_component_id, student_id),
  foreign key (tenant_id, assessment_component_id) references assessment_components (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id)
);
create index idx_scores_tenant on scores (tenant_id);
create index idx_scores_tenant_component on scores (tenant_id, assessment_component_id);

alter table scores enable row level security;
create policy tenant_isolation_scores on scores
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on subjects, assessment_structures, assessment_components, scores to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
