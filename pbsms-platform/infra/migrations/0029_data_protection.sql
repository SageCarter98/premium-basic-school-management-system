-- ============================================================================
-- 0029_data_protection.sql
--
-- Implements SRS v2.1 Chapter 39 (Ghana Data Protection Act & GDPR
-- Alignment) and Chapter 40 (Consent, Retention & Data Subject Rights) —
-- Phase F of the multi-phase completion plan.
--
-- Five tables, split by what's genuinely tenant-scoped vs. platform-scoped:
--
--   PLATFORM tables (no RLS, same TEN-005 category as tenants/plans):
--   - data_inventory (DP-020): the lawful-basis-per-category inventory —
--     this describes the PRODUCT's own data model, the same "reference
--     data about the system, not about any one tenant" category as
--     `plans`. Seeded with the real categories this actual codebase
--     collects, not aspirational ones.
--   - retention_policies (40.2): Chapter 40.2's retention schedule table,
--     seeded verbatim as real reference data.
--   - data_breach_incidents (DP-040): breach assessment/DPC reporting is a
--     COMPANY-level obligation per DP-010's own framing ("PBSMS (the
--     company) MUST register..."), potentially spanning multiple tenants
--     at once (`affected_tenant_ids`), not owned by any single tenant.
--
--   TENANT tables (ordinary RLS'd tenant tables):
--   - data_subject_requests (DP-030/DP-090): the access/rectification/
--     erasure workflow, routed to "the correct tenant's administrator" —
--     genuinely tenant-owned.
--   - consent_records (DP-070/DP-080): communication-channel and
--     biometric consent, per guardian — tenant-owned, versioned (a new
--     row per grant/withdraw event, current state = latest row per
--     subject+type+channel, same "insert a new version, never mutate
--     history" principle student_results/notification_templates already
--     use elsewhere in this codebase).
--
-- Deliberately NOT built, documented not silently skipped — see this
-- migration's header comment in analytics.service.ts's sibling module for
-- the same discipline applied here:
--   - DP-010 (company registers as a data controller with Ghana's DPC):
--     a real-world legal/organizational act, not a software feature.
--   - DP-050 (GDPR alignment, DPIA for high-risk processing): a
--     documentation/process deliverable (the DPIA itself is a document),
--     satisfied by the SAME mechanisms below applying uniformly
--     regardless of a guardian's location — no separate "EU mode" to
--     build.
--   - DP-060 (controller/processor roles): already true by construction
--     — tenant staff act only within their own tenant (RLS), platform-role
--     actions are already documented/audited (Phase A2/A3's dual-logging).
--     Nothing new to build; the existing authorization/audit machinery
--     IS the evidence for this clause.
--   - 40.2's actual DESTRUCTIVE retention purge (deleting/archiving real
--     records once their retention period expires, permanently deleting
--     a closed tenant's data after its 90-day window) — a genuinely
--     catastrophic, hard-to-reverse operation across every table in this
--     schema. This pass builds the DEFINITION (retention_policies) and a
--     SAFE, READ-ONLY eligibility report (retention-eligible records,
--     queryable, nothing deleted) — never an automated purge. Actually
--     executing a purge needs its own explicit, reviewed, almost
--     certainly human-approved mechanism — the same caution this
--     codebase already applies to real payment processing and actual
--     tenant deletion, not something to bolt onto a background job
--     during a single pass.
-- ============================================================================

create table data_inventory (
  id                     uuid primary key default gen_random_uuid(),
  data_category          text not null unique,
  description            text not null,
  lawful_basis           text not null
                           constraint data_inventory_lawful_basis_check check (
                             lawful_basis in ('consent', 'contract_necessity', 'legal_obligation', 'legitimate_interest')
                           ),
  sensitivity_classification text not null,
  source_tables          text[] not null default '{}',
  created_at             timestamptz not null default now()
);

create table retention_policies (
  id                    uuid primary key default gen_random_uuid(),
  record_type           text not null unique,
  retention_description text not null,
  retention_years       numeric(4, 1),  -- null = permanent (e.g. core academic records)
  basis                 text not null,
  created_at            timestamptz not null default now()
);

create table data_breach_incidents (
  id                        uuid primary key default gen_random_uuid(),
  detected_at               timestamptz not null default now(),
  detected_by               uuid references users(id),
  -- DP-040's literal "assessed within 24 hours of detection".
  assessment_deadline       timestamptz not null,
  assessed_at               timestamptz,
  assessed_by               uuid references users(id),
  meets_statutory_threshold boolean,
  reported_to_dpc_at        timestamptz,
  affected_tenant_ids       uuid[] not null default '{}',
  description               text not null,
  status                    text not null default 'detected'
                              check (status in ('detected', 'assessing', 'reported', 'closed')),
  created_at                timestamptz not null default now(),
  created_by                uuid references users(id)
);

create table data_subject_requests (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  request_type        text not null check (request_type in ('access', 'rectification', 'erasure')),
  subject_type        text not null check (subject_type in ('guardian', 'staff', 'student')),
  subject_id          uuid not null,  -- no FK: polymorphic across students/guardians/users, same pattern as notifications
  requester_name      text not null,
  requester_contact   text,
  assigned_to         uuid references users(id),
  status              text not null default 'received'
                        check (status in ('received', 'in_progress', 'fulfilled', 'rejected')),
  -- DP-030's literal 30-day SLA, computed at insert time.
  due_date            timestamptz not null,
  fulfilled_at        timestamptz,
  fulfillment_notes   text,
  rejection_reason    text,
  created_at          timestamptz not null default now(),
  created_by          uuid references users(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references users(id),
  unique (tenant_id, id)
);
create index idx_data_subject_requests_tenant on data_subject_requests (tenant_id);

alter table data_subject_requests enable row level security;
create policy tenant_isolation_data_subject_requests on data_subject_requests
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table consent_records (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  subject_type   text not null check (subject_type in ('guardian', 'staff', 'student')),
  subject_id     uuid not null,  -- no FK, same polymorphic pattern as communication_preferences
  consent_type   text not null check (consent_type in ('communication_channel', 'biometric')),
  channel        text check (channel in ('whatsapp', 'sms', 'email')),
  granted        boolean not null,
  -- Incremented per subject_type+subject_id+consent_type+channel in
  -- data-protection.service.ts — a new row per grant/withdraw event,
  -- never mutated, same "insert a new version" principle
  -- notification_templates/student_results already use.
  version        integer not null,
  recorded_at    timestamptz not null default now(),
  withdrawn_at   timestamptz,
  recorded_by    uuid references users(id),
  constraint consent_records_channel_required_check check (
    (consent_type = 'communication_channel' and channel is not null)
    or (consent_type = 'biometric' and channel is null)
  ),
  unique (tenant_id, id)
);
create index idx_consent_records_tenant on consent_records (tenant_id);
create index idx_consent_records_subject on consent_records (tenant_id, subject_type, subject_id, consent_type);

alter table consent_records enable row level security;
create policy tenant_isolation_consent_records on consent_records
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update on data_subject_requests, consent_records to pbsms_app;
-- Platform tables: read-only reference data + platform-owned breach
-- tracking. pbsms_app gets SELECT on the two reference tables (any tenant
-- app screen can display "why we collect X" / the retention schedule) but
-- no write access — these are curated centrally, not per-tenant editable.
-- data_breach_incidents is reachable only via pbsms_platform (below),
-- same TEN-005 category as platform_audit_logs.
grant select on data_inventory, retention_policies to pbsms_app;
grant select, insert, update on data_breach_incidents to pbsms_platform;

-- ----------------------------------------------------------------------------
-- Seed the two reference tables with real, current data — not aspirational
-- placeholders. data_inventory's source_tables point at tables that
-- genuinely exist in this schema today; retention_policies is Chapter
-- 40.2's schedule transcribed verbatim.
-- ----------------------------------------------------------------------------
insert into data_inventory (data_category, description, lawful_basis, sensitivity_classification, source_tables) values
  ('student_identity', 'Student name, date of birth, gender, admission number', 'contract_necessity', 'confidential', array['students']),
  ('guardian_contact', 'Guardian name, phone, email and relationship to student', 'contract_necessity', 'confidential', array['guardians', 'student_guardians']),
  ('academic_records', 'Scores, results, report cards and transcripts', 'contract_necessity', 'confidential', array['scores', 'student_results', 'student_result_items', 'generated_documents']),
  ('attendance_records', 'Daily attendance status per student', 'contract_necessity', 'confidential', array['attendance_records']),
  ('financial_records', 'Fees, invoices, payments and financial assistance', 'contract_necessity', 'confidential', array['invoices', 'payments', 'financial_assistance']),
  ('health_records', 'Health incidents and medication administration', 'consent', 'highly_confidential', array['health_records', 'health_incidents', 'medication_administration_log']),
  ('discipline_records', 'Discipline cases, responses and appeals', 'legitimate_interest', 'confidential', array['discipline_cases', 'discipline_case_notes', 'discipline_appeals']),
  ('biometric_data', 'Fingerprint/RFID attendance identifiers — Chapter 36.2, a defined gap not yet collected by this platform', 'consent', 'highly_confidential', array[]::text[]);

insert into retention_policies (record_type, retention_description, retention_years, basis) values
  ('core_academic_record', 'Results, report cards, certificates — permanent, archived after graduation, never deleted', null, 'Lifelong reference value; BECE/SHS placement verification'),
  ('attendance_record', '7 years post-graduation, then archived to cold storage', 7, 'Aligned to typical Ghanaian record-keeping norms for schools'),
  ('financial_transaction', '7 years, per standard Ghanaian financial record-keeping practice', 7, 'Tax and audit requirements'),
  ('medical_health_record', 'Duration of enrolment + 3 years, then archived with restricted access', 3, 'Ongoing care relevance balanced against minimization'),
  ('discipline_record', 'Duration of enrolment + 1 year unless a legal matter is pending', 1, 'Minimization; avoids indefinitely following a minor'),
  ('biometric_template', 'Deleted within 30 days of a student or staff member''s exit from the tenant', 0.1, 'Highly Confidential classification; minimization'),
  ('audit_log', '3 years online, then cold archive for 7 years total', 3, 'Security investigation and compliance need'),
  ('tenant_data_after_closure', '90-day recoverable export window, then permanent deletion except statutory-retention categories above', 0.25, 'Balances customer recovery against minimization');
