-- ============================================================================
-- 0028_analytics.sql
--
-- Implements SRS v2.1 Chapter 14 (Operational Intelligence Framework) —
-- Phase E of the multi-phase completion plan. Chapter 14.1 lists 9
-- components; most already exist elsewhere in this codebase under
-- different names (Scheduler = Phase D's job_schedules; Email/SMS/
-- WhatsApp/Notification Engine = modules/communication; Action Tracker/
-- Escalation Engine = communication's notification_reports acknowledge/
-- escalate workflow, Chapter 26). This migration builds the two that
-- don't exist yet: the KPI Engine (14.2) and Executive Dashboards/Group
-- Roll-Up (14.3, FR-ANL-010).
--
-- Deliberately NOT built, documented not silently skipped: Chapter 14.4/
-- Chapter 27's FR-ANL-040 "AI-assisted summarization" — the SRS itself
-- frames this as aspirational future scope ("Future AI features MAY..."),
-- there is no LLM/AI provider integration anywhere in this codebase to
-- wrap, and unlike WhatsApp/SMS (a concrete FR- ask blocked only on
-- vendor credentials), there is no committed provider decision to build
-- against yet — same category of gap as every other "blocked on external
-- decision, not attempted" deferral in this codebase, not a special case
-- needing its own confirmation.
--
-- KPI "formula" (14.2's metadata list) is NOT a stored, executable
-- formula string — building a generic formula-interpreter engine is a
-- much larger, different-shaped feature than what Chapter 14.3/27.1
-- actually name ("collections, attendance, academic performance and
-- outstanding actions"). Instead, kpi_definitions.data_source is a CHECK-
-- constrained enum of four concrete, real calculators
-- (analytics.service.ts), the same "don't fake a general engine, build
-- the named concrete cases" discipline this codebase already applied to
-- Chapter 13.4's conflict-of-interest detection. formula_description is
-- free text for the metadata list's own sake (documentation/display),
-- never executed.
-- ============================================================================

create table kpi_definitions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  code                text not null,
  name                text not null,
  responsible_role    text not null,
  data_source         text not null
                        constraint kpi_definitions_data_source_check check (
                          data_source in ('collection_rate', 'attendance_rate', 'academic_performance', 'outstanding_actions')
                        ),
  formula_description text,
  target               numeric(10, 2),
  weight               numeric(5, 2),
  warning_threshold    numeric(10, 2),
  critical_threshold   numeric(10, 2),
  reporting_frequency  text not null
                         constraint kpi_definitions_frequency_check check (
                           reporting_frequency in ('daily', 'weekly', 'monthly', 'termly', 'yearly')
                         ),
  supervisor_user_id   uuid references users(id),
  status               text not null default 'active' check (status in ('active', 'inactive')),
  -- null = tenant-wide KPI; set = one specific school's KPI (14.2's
  -- "tenant scope" field) — composite FK below stops a same-tenant-only
  -- invariant violation at the schema level, not just RLS.
  school_id            uuid,
  created_at           timestamptz not null default now(),
  created_by           uuid references users(id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references users(id),
  unique (tenant_id, code),
  unique (tenant_id, id),
  foreign key (tenant_id, school_id) references schools (tenant_id, id)
);
create index idx_kpi_definitions_tenant on kpi_definitions (tenant_id);

alter table kpi_definitions enable row level security;
create policy tenant_isolation_kpi_definitions on kpi_definitions
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- A computed value for one KPI over one period — the "Reporting Engine"
-- half of 14.1. status here is DERIVED (value vs. thresholds), not
-- caller-supplied — see analytics.service.ts's computeKpi() for the
-- higher-is-better vs. lower-is-better direction per data_source.
create table kpi_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  kpi_definition_id  uuid not null,
  school_id          uuid,
  period_start       date not null,
  period_end         date not null,
  value              numeric(10, 2) not null,
  status             text not null check (status in ('on_target', 'warning', 'critical')),
  computed_at        timestamptz not null default now(),
  created_by         uuid references users(id),
  foreign key (tenant_id, kpi_definition_id) references kpi_definitions (tenant_id, id)
);
create index idx_kpi_snapshots_tenant on kpi_snapshots (tenant_id);
create index idx_kpi_snapshots_definition on kpi_snapshots (tenant_id, kpi_definition_id, period_start);

alter table kpi_snapshots enable row level security;
create policy tenant_isolation_kpi_snapshots on kpi_snapshots
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update on kpi_definitions, kpi_snapshots to pbsms_app;
