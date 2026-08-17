-- ============================================================================
-- 0030_nacca_curriculum.sql
--
-- Implements SRS v2.1 Chapter 41 (NaCCA, BECE, GES & CSSPS Alignment) —
-- Phase G, the last of the multi-phase completion plan (A-G), explicitly
-- named the SRS's own lowest priority ("if pilot demands" framing).
-- `assessment_components.nacca_strand` (0004_assessment.sql) was a
-- deliberate PLACEHOLDER column, documented in that migration's own
-- comment as "not the full NaCCA strand/sub-strand model, which is out of
-- scope here" — this migration is that model, finally built.
--
-- Every DOM- requirement in Chapter 41 uses "MAY"/tenant-opt-in language
-- (41.1's own words: "as a tenant-level opt-in on top of the generic
-- subject model") — nothing here changes existing behaviour for a tenant
-- that doesn't opt in. `school_academic_settings.uses_nacca_curriculum`
-- is that opt-in flag, a NEW table rather than an ALTER on `schools`
-- (0001_init_tenancy.sql) — keeps this genuinely additive (NFR-DEP-030)
-- and avoids touching the single most foundational table in this schema
-- for a feature most tenants will never use.
--
-- 41.1 NaCCA curriculum (DOM-010/020/030): strand -> sub-strand ->
-- indicator, THREE levels not four — the SRS's own text lists "content
-- standards -> indicators" as two levels under sub-strand, but nothing
-- else in this schema goes four levels deep and DOM-020's actual ask
-- (tag an assessment item to "a specific indicator" for coverage
-- reporting) doesn't need content standards as a separate joinable
-- entity — content_standard_code/text live as attributes ON the
-- indicator row instead. Documented simplification, not a missed
-- requirement. `assessment_components` gets an ADDITIVE nullable
-- `indicator_id` column alongside its existing `nacca_strand` text
-- placeholder (left untouched — still usable by a tenant that wants
-- lightweight free-text tagging without the full structured model).
--
-- 41.2 BECE support (DOM-040/050/060): bece_candidates (index numbers —
-- generated internally as school-code+year+sequence, since this is
-- "informational recording," not a live WAEC integration, same DOM-080
-- framing applied here too) and bece_mock_results (the real 1-9
-- WAEC-equivalent grade scale, genuinely different from
-- grading_policies' existing percentage-band model, 0005_grading.sql —
-- not reused, because it IS a different scale for a different purpose).
--
-- 41.3 GES statutory reporting (DOM-070): no new tables — enrolment
-- census / attendance returns are read-only aggregations over
-- students/enrolments/attendance_records, built as service methods in
-- nacca.service.ts, not a new schema.
--
-- 41.4 CSSPS placement (DOM-080): cssps_placements — "informational
-- recording, not an integration with the CSSPS system itself," per the
-- SRS's own explicit words, so this is a plain record with no external
-- call anywhere.
-- ============================================================================

create table school_academic_settings (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  school_id             uuid not null,
  uses_nacca_curriculum boolean not null default false,
  created_at            timestamptz not null default now(),
  created_by            uuid references users(id),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references users(id),
  unique (tenant_id, school_id),
  foreign key (tenant_id, school_id) references schools (tenant_id, id)
);
alter table school_academic_settings enable row level security;
create policy tenant_isolation_school_academic_settings on school_academic_settings
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table curriculum_strands (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  subject_id  uuid not null,
  name        text not null,
  code        text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id),
  unique (tenant_id, id),
  unique (tenant_id, subject_id, code),
  foreign key (tenant_id, subject_id) references subjects (tenant_id, id)
);
alter table curriculum_strands enable row level security;
create policy tenant_isolation_curriculum_strands on curriculum_strands
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table curriculum_sub_strands (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  strand_id   uuid not null,
  name        text not null,
  code        text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id),
  unique (tenant_id, id),
  unique (tenant_id, strand_id, code),
  foreign key (tenant_id, strand_id) references curriculum_strands (tenant_id, id)
);
alter table curriculum_sub_strands enable row level security;
create policy tenant_isolation_curriculum_sub_strands on curriculum_sub_strands
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table curriculum_indicators (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  sub_strand_id          uuid not null,
  content_standard_code  text,
  content_standard_text  text,
  indicator_code         text not null,
  indicator_text         text not null,
  created_at             timestamptz not null default now(),
  created_by             uuid references users(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references users(id),
  unique (tenant_id, id),
  unique (tenant_id, sub_strand_id, indicator_code),
  foreign key (tenant_id, sub_strand_id) references curriculum_sub_strands (tenant_id, id)
);
alter table curriculum_indicators enable row level security;
create policy tenant_isolation_curriculum_indicators on curriculum_indicators
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- Additive: nullable, no default beyond null, existing rows/behaviour
-- entirely unaffected (NFR-DEP-030). A NULL in either column of a
-- composite FK is never checked (Postgres MATCH SIMPLE, the default),
-- so this is safe for every existing row that will never set it.
alter table assessment_components add column indicator_id uuid;
alter table assessment_components
  add constraint assessment_components_indicator_fk
  foreign key (tenant_id, indicator_id) references curriculum_indicators (tenant_id, id);

create table bece_candidates (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  student_id         uuid not null,
  academic_year_id   uuid not null,
  index_number       text not null,
  registration_status text not null default 'registered'
                       check (registration_status in ('registered', 'confirmed', 'withdrawn')),
  created_at         timestamptz not null default now(),
  created_by         uuid references users(id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references users(id),
  unique (tenant_id, id),
  unique (tenant_id, index_number),
  unique (tenant_id, student_id, academic_year_id),
  foreign key (tenant_id, student_id) references students (tenant_id, id),
  foreign key (tenant_id, academic_year_id) references academic_years (tenant_id, id)
);
alter table bece_candidates enable row level security;
create policy tenant_isolation_bece_candidates on bece_candidates
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table bece_mock_results (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  bece_candidate_id uuid not null,
  exam_session      text not null,  -- e.g. 'Mock 1 2026'
  subject_name      text not null,
  -- WAEC/BECE's real 1 (best) - 9 (worst) grade scale — deliberately NOT
  -- grading_policies' existing percentage-band model (0005_grading.sql),
  -- which serves ordinary termly reporting, a different scale for a
  -- different purpose.
  grade             integer not null check (grade between 1 and 9),
  score_percentage  numeric(5, 2),
  created_at        timestamptz not null default now(),
  created_by        uuid references users(id),
  unique (tenant_id, id),
  unique (tenant_id, bece_candidate_id, exam_session, subject_name),
  foreign key (tenant_id, bece_candidate_id) references bece_candidates (tenant_id, id)
);
alter table bece_mock_results enable row level security;
create policy tenant_isolation_bece_mock_results on bece_mock_results
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table cssps_placements (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  student_id             uuid not null,
  choices                text[] not null default '{}',
  placement_outcome      text,
  placement_confirmed_at timestamptz,
  created_at             timestamptz not null default now(),
  created_by             uuid references users(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references users(id),
  unique (tenant_id, id),
  unique (tenant_id, student_id),
  foreign key (tenant_id, student_id) references students (tenant_id, id)
);
alter table cssps_placements enable row level security;
create policy tenant_isolation_cssps_placements on cssps_placements
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update on
  school_academic_settings, curriculum_strands, curriculum_sub_strands, curriculum_indicators,
  bece_candidates, bece_mock_results, cssps_placements
to pbsms_app;
