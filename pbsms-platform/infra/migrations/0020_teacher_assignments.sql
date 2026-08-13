-- ============================================================================
-- 0020_teacher_assignments.sql
--
-- Implements Chapter 17.1's "Teacher Assignments" step in the academic
-- hierarchy (Tenant -> School -> Campus -> Academic Year -> Term ->
-- Division -> Class Level -> Class/Section -> Class Subjects -> Teacher
-- Assignments) and FR-ASM-020 ("restrict score entry to teachers with an
-- active assignment for that class subject in the current term"). This is
-- the gap 0004_assessment.sql's own header flagged: "this migration adds
-- `subjects`, not the rest" of Chapter 17's hierarchy.
--
-- Scope notes (read before extending this):
--   - This schema has no `terms` table — academic_years is the only
--     year/period entity that exists (0001_init_tenancy.sql), the same
--     simplification 0004_assessment.sql already made for
--     assessment_structures. teacher_assignments.academic_year_id is
--     therefore standing in for FR-ASM-020's "current term"; a real Term
--     entity is a separate, larger Chapter 17 item, not built here.
--   - teacher_id references users(id) directly (not a tenant-scoped
--     composite, and not through tenant_users) because a teacher is
--     unambiguously a real system user once validated by the service
--     layer against tenant_users.role_code = 'teacher' — the same
--     reasoning 0018_staff_directory.sql used for every actor-identity
--     column, not the polymorphic recipient_id pattern communication/
--     discipline/health use (those genuinely span multiple target
--     tables; this doesn't).
--   - No is_class_teacher flag. Chapter 21.1's "Class Teacher" reviewer
--     step in the results workflow is a related but separate concept
--     (a class-level role, not a class+subject assignment) — deliberately
--     left out of this pass rather than bolted on with nothing yet
--     consuming it.
--   - FR-ACA-040 (teacher/class/room timetable-conflict detection) needs a
--     real timetable/period/room model that doesn't exist in this schema.
--     Out of scope here; this migration only prevents a *duplicate* active
--     assignment for the same teacher+class+subject+year (see the partial
--     unique index below), not a scheduling-conflict check.
-- ============================================================================

create table teacher_assignments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  teacher_id        uuid not null references users(id),
  class_id          uuid not null,
  subject_id        uuid not null,
  academic_year_id  uuid not null,
  status            text not null default 'active' check (status in ('active', 'ended')),
  ended_at          timestamptz,
  ended_reason      text,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, class_id) references classes (tenant_id, id),
  foreign key (tenant_id, subject_id) references subjects (tenant_id, id),
  foreign key (tenant_id, academic_year_id) references academic_years (tenant_id, id)
);
create index idx_teacher_assignments_tenant on teacher_assignments (tenant_id);
create index idx_teacher_assignments_tenant_teacher on teacher_assignments (tenant_id, teacher_id);
create index idx_teacher_assignments_tenant_slot on teacher_assignments (tenant_id, class_id, subject_id, academic_year_id);

-- Blocks a duplicate ACTIVE assignment for the same teacher+class+subject+
-- year (a no-op re-assignment). Does NOT block two different teachers both
-- being active on the same class+subject at once — co-teaching isn't
-- prohibited by the SRS, so this deliberately doesn't invent that rule.
create unique index uq_teacher_assignments_active_slot
  on teacher_assignments (tenant_id, teacher_id, class_id, subject_id, academic_year_id)
  where status = 'active';

alter table teacher_assignments enable row level security;
create policy tenant_isolation_teacher_assignments on teacher_assignments
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on teacher_assignments to pbsms_app;

alter table teacher_assignments add constraint teacher_assignments_created_by_fkey foreign key (created_by) references users(id);
alter table teacher_assignments add constraint teacher_assignments_updated_by_fkey foreign key (updated_by) references users(id);

-- ----------------------------------------------------------------------------
-- Sanity checks to run manually after applying this file:
--
-- 1. RLS enabled:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname = 'teacher_assignments';
-- -- should return zero rows.
-- ----------------------------------------------------------------------------
