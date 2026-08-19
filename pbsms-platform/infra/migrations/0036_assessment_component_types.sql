-- ============================================================================
-- 0036_assessment_component_types.sql
--
-- Closes add-assessment-component.dto.ts's documented "true per-tenant
-- custom types are a future enhancement" deferral. The 5 built-in types
-- (class_exercise, homework, project, mid_term, end_of_term_exam) stay
-- valid everywhere — they're recognized in application code
-- (assessment.service.ts), not stored per-tenant, since every tenant gets
-- them for free. This table only holds ADDITIONS a tenant defines beyond
-- those 5 (e.g. "practical_exam", "group_presentation").
--
-- Scope notes:
--   - component_type on assessment_components moves from a fixed CHECK
--     constraint to free text — validated in assessment.service.ts
--     against the built-in 5 OR a matching row here instead, since a
--     per-tenant value can't be a compile-time CHECK. The unique
--     (tenant_id, assessment_structure_id, component_type) constraint
--     from 0004_assessment.sql is untouched — one component per type per
--     structure still holds regardless of where the type came from.
--   - No FK from assessment_components.component_type to this table's
--     code — components already reference the 5 built-ins, which have no
--     row here at all, so a hard FK would have to special-case them
--     anyway. Same "validated in the service, not the schema" posture
--     the DTO's own header comment already used for componentType before
--     this migration.
-- ============================================================================

alter table assessment_components drop constraint assessment_components_component_type_check;

create table assessment_component_types (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  code        text not null,
  name        text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  unique (tenant_id, id),
  unique (tenant_id, code)
);
create index idx_assessment_component_types_tenant on assessment_component_types (tenant_id);

alter table assessment_component_types enable row level security;
create policy tenant_isolation_assessment_component_types on assessment_component_types
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- Additive reference list only — a type once defined and possibly already
-- referenced by real components shouldn't be silently renamed or removed
-- through this table; no update/delete grant, matching audit_log's
-- append-only posture for the same "don't let a later action invalidate
-- history" reason.
grant select, insert on assessment_component_types to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
