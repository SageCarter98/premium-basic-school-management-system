-- ============================================================================
-- 0014_health.sql
--
-- Implements SRS v2.1 Chapter 28 (FR-OPS-030): "restricted-access medical
-- records, incident logging, medication administration log, guardian
-- notification for incidents." Fourth of Chapter 28's five domains — the
-- structurally closest to Discipline (0011): an incident with a small
-- state machine and a guardian-contact path that dispatches through
-- CommunicationService.
--
-- Scope notes (read before extending this):
--   - health_incident_guardian_contacts is a second, independent copy of
--     discipline_guardian_contacts' exact shape (recipient_type/id,
--     channel, notification_id FK, notes) rather than a shared
--     polymorphic table — matching this codebase's "copy the pattern per
--     module" convention (see e.g. every module's own isolation-test
--     block). health.service.ts's contactGuardian() calls
--     CommunicationService with sensitivity 'confidential', same as
--     discipline's, per FR-COM-050 — medical data if anything deserves
--     that restriction more, not less.
--   - Restricting health_records access beyond ordinary tenant-level RLS
--     (FR-STU-040 "restrict health information beyond general student
--     data", Chapter 13's role/record scoping) is NOT implemented — no
--     module in this codebase implements role-based row scoping yet
--     (same deferral discipline's migration documents).
--   - health_incidents reuses discipline_cases' severity scale
--     (minor/moderate/major/severe) for consistency across the codebase
--     rather than inventing a medical-specific scale the SRS doesn't ask
--     for.
-- ============================================================================

create table health_records (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  student_id    uuid not null,
  blood_group   text,
  allergies     text,
  conditions    text,
  notes         text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  unique (tenant_id, id),
  unique (tenant_id, student_id),
  foreign key (tenant_id, student_id) references students (tenant_id, id)
);
create index idx_health_records_tenant on health_records (tenant_id);

alter table health_records enable row level security;
create policy tenant_isolation_health_records on health_records
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table health_incidents (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  student_id     uuid not null,
  incident_date  date not null,
  description    text not null,
  severity       text not null check (severity in ('minor', 'moderate', 'major', 'severe')),
  status         text not null default 'reported' check (status in ('reported', 'resolved')),
  resolved_at    timestamptz,
  reopened_at    timestamptz,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id)
);
create index idx_health_incidents_tenant on health_incidents (tenant_id);
create index idx_health_incidents_tenant_student on health_incidents (tenant_id, student_id);

alter table health_incidents enable row level security;
create policy tenant_isolation_health_incidents on health_incidents
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table health_incident_guardian_contacts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  incident_id     uuid not null,
  recipient_type  text not null check (recipient_type in ('guardian', 'staff', 'student')),
  recipient_id    uuid not null,   -- no FK: see header (guardians are not a real table yet)
  channel         text check (channel in ('whatsapp', 'sms', 'email', 'phone_call', 'in_person')),
  notification_id uuid,
  notes           text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid not null,
  unique (tenant_id, id),
  foreign key (tenant_id, incident_id) references health_incidents (tenant_id, id),
  foreign key (tenant_id, notification_id) references notifications (tenant_id, id)
);
create index idx_health_incident_guardian_contacts_tenant on health_incident_guardian_contacts (tenant_id);
create index idx_health_incident_guardian_contacts_tenant_incident on health_incident_guardian_contacts (tenant_id, incident_id);

alter table health_incident_guardian_contacts enable row level security;
create policy tenant_isolation_health_incident_guardian_contacts on health_incident_guardian_contacts
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table medication_administration_log (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  student_id       uuid not null,
  medication_name  text not null,
  dosage           text not null,
  administered_by  uuid not null,
  administered_at  timestamptz not null default now(),
  notes            text,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id)
);
create index idx_medication_administration_log_tenant on medication_administration_log (tenant_id);
create index idx_medication_administration_log_tenant_student on medication_administration_log (tenant_id, student_id);

alter table medication_administration_log enable row level security;
create policy tenant_isolation_medication_administration_log on medication_administration_log
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on
  health_records, health_incidents, health_incident_guardian_contacts, medication_administration_log
to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
