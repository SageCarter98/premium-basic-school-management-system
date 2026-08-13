-- ============================================================================
-- 0019_guardians.sql
--
-- Implements the "guardians as a real table" gap noted throughout this
-- codebase's history (communication/discipline/health module headers,
-- 0018_staff_directory.sql's own header, README's deferred-items list):
-- FR-STU-020 ("support multiple guardians per student and multiple
-- students per guardian, with relationship-level flags for primary
-- contact, emergency, pickup, finance and report access" — SRS v2.1
-- Chapter 16.2) has never had a real table backing it. Every
-- recipient_type='guardian' id across communication/discipline/health has
-- been an unvalidated UUID until now.
--
-- Two tables:
--   guardians          — the person: name + contact details.
--   student_guardians  — the many-to-many link FR-STU-020 asks for, one
--                         row per (student, guardian) pair, carrying the
--                         relationship-level flags the requirement names
--                         explicitly.
--
-- guardians gets the same unique(tenant_id, id) students/schools already
-- have, so student_guardians can use the same tenant-scoped composite FK
-- convention as students.school_id -> schools(tenant_id, id) rather than
-- a plain single-column FK (which would let a row link a Tenant A student
-- to a Tenant B guardian — RLS blocks the READ side of that, but a
-- same-transaction INSERT under the wrong session could otherwise still
-- write it; the composite FK makes it impossible at the schema level,
-- not just the RLS level).
--
-- Deliberately NOT built here — see README for why each is a separate,
-- unscoped item, not silently skipped:
--   - Guardian portal/login (Chapter 34 parent mobile experience,
--     FR-STU-060) — no frontend exists for it yet; guardians here are a
--     records-only entity, not a users/tenant_users row. Nothing stops a
--     future migration adding an optional users.id FK if that's ever
--     built, but adding it speculatively now with nothing to use it
--     would be exactly the kind of hypothetical-future column this
--     codebase's own conventions argue against.
--   - FR-STU-060's actual record-scoping enforcement ("guardians see only
--     linked learners") — that's Chapter 13.3's broader record-
--     relationship-scope item, already tracked separately in README; this
--     migration makes the relationship real and queryable, it doesn't
--     wire any access-control decision to it.
--   - Auto-populating notification recipientName/Phone/Email from this
--     table — communication.service.ts's existing "snapshot contact
--     details at send time, not a live join" design (0010_communication.sql's
--     header) is deliberate and stays as-is; this migration only adds
--     real-id validation on top of it (see staff.service.ts's
--     isRealStaffMember() for the identical existing pattern this mirrors).
-- ============================================================================

create table guardians (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  full_name    text not null,
  phone        text,
  email        text,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  unique (tenant_id, id)
);
create index idx_guardians_tenant on guardians (tenant_id);

alter table guardians enable row level security;
create policy tenant_isolation_guardians on guardians
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table student_guardians (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  student_id            uuid not null,
  guardian_id           uuid not null,
  relationship          text,   -- free text ('mother','father','uncle','guardian', ...) — SRS doesn't enumerate a fixed list
  is_primary_contact    boolean not null default false,
  is_emergency_contact  boolean not null default false,
  can_pickup            boolean not null default false,
  has_finance_access    boolean not null default false,
  has_report_access     boolean not null default false,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  unique (tenant_id, student_id, guardian_id),
  foreign key (tenant_id, student_id) references students (tenant_id, id),
  foreign key (tenant_id, guardian_id) references guardians (tenant_id, id)
);
create index idx_student_guardians_tenant on student_guardians (tenant_id);
create index idx_student_guardians_tenant_student on student_guardians (tenant_id, student_id);
create index idx_student_guardians_tenant_guardian on student_guardians (tenant_id, guardian_id);

alter table student_guardians enable row level security;
create policy tenant_isolation_student_guardians on student_guardians
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on guardians, student_guardians to pbsms_app;

alter table guardians add constraint guardians_created_by_fkey foreign key (created_by) references users(id);
alter table guardians add constraint guardians_updated_by_fkey foreign key (updated_by) references users(id);
alter table student_guardians add constraint student_guardians_created_by_fkey foreign key (created_by) references users(id);
alter table student_guardians add constraint student_guardians_updated_by_fkey foreign key (updated_by) references users(id);

-- ----------------------------------------------------------------------------
-- Sanity checks the migration author should run manually after applying this
-- file (same checks 0001's own footer documents):
--
-- 1. RLS enabled on both new tables:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname IN ('guardians','student_guardians');
-- -- should return zero rows.
-- ----------------------------------------------------------------------------
