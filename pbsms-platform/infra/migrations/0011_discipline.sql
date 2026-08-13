-- ============================================================================
-- 0011_discipline.sql
--
-- Implements SRS v2.1 Chapter 28 (Supporting Operations, FR-OPS-040) and its
-- student-lifecycle restatement (FR-STU-040): "incident recording,
-- investigation, response, guardian contact, follow-up, appeal, and
-- positive-behaviour recognition, all tenant- and record-scoped per
-- Chapter 13." First of Chapter 28's five independent domains (library,
-- transport, health, discipline, inventory) — built one module per pass,
-- same discipline as Finance/Communication before it (see README).
--
-- Scope notes (read before extending this):
--   - Two independent concerns, per FR-OPS-040's own wording: a stateful
--     disciplinary-case workflow (discipline_cases + four supporting
--     tables) and positive-behaviour recognition (discipline_recognitions,
--     a plain log with no workflow). One migration, two feature sets.
--   - "Follow-up" is not a separate table — it's discipline_case_notes,
--     an append-only log a case owner adds to over time, the same shape
--     as notification_report_comments. A dedicated action-tracker table
--     (owner/deadline/escalation, like notification_reports) would
--     duplicate that machinery for no requirement Chapter 28 actually
--     states; if a future pass needs deadline-tracked discipline
--     follow-ups, that's a notification_reports row referencing a case,
--     not a new table here.
--   - Guardian contact reuses communication's generic recipient_type/
--     recipient_id pair (no FK — guardians are still not a real table,
--     the same documented gap 0010_communication.sql's header describes).
--     discipline_guardian_contacts.notification_id links to a real
--     notifications row when the contact was dispatched through a channel
--     (whatsapp/sms/email) rather than logged as a phone_call/in_person
--     meeting. discipline.service.ts's contactGuardian() calls
--     CommunicationService directly with sensitivity_level = 'confidential'
--     — FR-COM-050's "discipline-related communication uses stricter
--     minimization and channel restriction" made concrete by reusing the
--     rule communication.service.ts's send() already enforces for
--     'confidential' notifications (email only, regardless of channel
--     requested), rather than inventing a second restriction mechanism.
--   - Role/record-level scoping (Chapter 13.3's "assigned students /
--     linked children / record ownership" scopes) is NOT implemented —
--     no existing module (attendance, assessment, finance, communication)
--     implements anything beyond tenant-level RLS either. Matching that
--     precedent, not inventing new enforcement alone in this one module.
--   - The retention rule ("duration of enrolment + 1 year unless a legal
--     matter is pending") is documented only, not enforced — no purge job
--     exists anywhere in this scaffold yet (same "schema-ready, job
--     deferred" shape as every other retention rule in the SRS).
-- ============================================================================

create table discipline_cases (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  student_id     uuid not null,
  category       text not null,   -- free text, e.g. 'fighting', 'bullying', 'truancy' — no fixed taxonomy in the SRS
  severity       text not null check (severity in ('minor', 'moderate', 'major', 'severe')),
  incident_date  date not null,
  description    text not null,
  reported_by    uuid not null,   -- no FK: actor-style columns are never FK'd elsewhere in this codebase either
  status         text not null default 'reported' check (
                    status in ('reported', 'investigating', 'response_issued', 'appealed', 'closed')
                  ),
  closed_at      timestamptz,
  reopened_at    timestamptz,     -- last time reopenCase() moved this case back from 'closed'
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id)
);
create index idx_discipline_cases_tenant on discipline_cases (tenant_id);
create index idx_discipline_cases_tenant_student on discipline_cases (tenant_id, student_id);

alter table discipline_cases enable row level security;
create policy tenant_isolation_discipline_cases on discipline_cases
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table discipline_case_notes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  case_id        uuid not null,
  author_user_id uuid not null,
  note           text not null,
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, case_id) references discipline_cases (tenant_id, id)
);
create index idx_discipline_case_notes_tenant on discipline_case_notes (tenant_id);
create index idx_discipline_case_notes_tenant_case on discipline_case_notes (tenant_id, case_id);

alter table discipline_case_notes enable row level security;
create policy tenant_isolation_discipline_case_notes on discipline_case_notes
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table discipline_case_responses (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  case_id       uuid not null,
  response_type text not null check (
                  response_type in ('warning', 'detention', 'suspension', 'expulsion_recommendation', 'other')
                ),
  description   text not null,
  created_at    timestamptz not null default now(),
  created_by    uuid not null,
  unique (tenant_id, id),
  foreign key (tenant_id, case_id) references discipline_cases (tenant_id, id)
);
create index idx_discipline_case_responses_tenant on discipline_case_responses (tenant_id);
create index idx_discipline_case_responses_tenant_case on discipline_case_responses (tenant_id, case_id);

alter table discipline_case_responses enable row level security;
create policy tenant_isolation_discipline_case_responses on discipline_case_responses
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table discipline_guardian_contacts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  case_id         uuid not null,
  recipient_type  text not null check (recipient_type in ('guardian', 'staff', 'student')),
  recipient_id    uuid not null,   -- no FK: see header (guardians are not a real table yet)
  -- Populated only when the contact went through a real dispatch channel
  -- (see header); null for a logged phone_call/in_person contact.
  channel         text check (channel in ('whatsapp', 'sms', 'email', 'phone_call', 'in_person')),
  notification_id uuid,
  notes           text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid not null,
  unique (tenant_id, id),
  foreign key (tenant_id, case_id) references discipline_cases (tenant_id, id),
  foreign key (tenant_id, notification_id) references notifications (tenant_id, id)
);
create index idx_discipline_guardian_contacts_tenant on discipline_guardian_contacts (tenant_id);
create index idx_discipline_guardian_contacts_tenant_case on discipline_guardian_contacts (tenant_id, case_id);

alter table discipline_guardian_contacts enable row level security;
create policy tenant_isolation_discipline_guardian_contacts on discipline_guardian_contacts
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table discipline_appeals (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  case_id         uuid not null,
  raised_by       uuid not null,
  reason          text not null,
  filed_at        timestamptz not null default now(),
  decision        text not null default 'pending' check (decision in ('pending', 'upheld', 'denied')),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_notes  text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, case_id) references discipline_cases (tenant_id, id)
);
create index idx_discipline_appeals_tenant on discipline_appeals (tenant_id);
create index idx_discipline_appeals_tenant_case on discipline_appeals (tenant_id, case_id);

alter table discipline_appeals enable row level security;
create policy tenant_isolation_discipline_appeals on discipline_appeals
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table discipline_recognitions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  student_id   uuid not null,
  category     text not null,   -- free text, e.g. 'academic_excellence', 'leadership', 'sportsmanship'
  description  text not null,
  awarded_by   uuid not null,
  awarded_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id)
);
create index idx_discipline_recognitions_tenant on discipline_recognitions (tenant_id);
create index idx_discipline_recognitions_tenant_student on discipline_recognitions (tenant_id, student_id);

alter table discipline_recognitions enable row level security;
create policy tenant_isolation_discipline_recognitions on discipline_recognitions
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on
  discipline_cases, discipline_case_notes, discipline_case_responses,
  discipline_guardian_contacts, discipline_appeals, discipline_recognitions
to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
