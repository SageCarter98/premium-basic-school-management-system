-- ============================================================================
-- 0003_attendance.sql
--
-- Implements SRS v2.1 Chapter 18 (Attendance Management, FR-ATT-010..050).
-- Per Chapter 44.3 this is the module after admissions/student-lifecycle/
-- academic-structure, and it is explicitly NOT "just another CRUD module"
-- (see Chapter 18.2, FR-ATT-010/011, and Chapter 34.3 FR-UX-020): capture
-- MUST work offline on a teacher's device, queued locally and synced later,
-- with a specific conflict rule — not last-write-wins-always.
--
-- This migration and its module (apps/api/src/modules/attendance/) build
-- the SERVER HALF of that contract: an idempotent, conflict-aware sync
-- endpoint a real offline client can call once built. The actual PWA client
-- (service worker, IndexedDB queue, background sync — Chapter 34.3) is
-- NOT built here; that is a separate frontend-architecture decision with
-- its own tooling choices, not something to bolt onto a backend migration.
-- See README.md's "Where to go next" for that gap stated explicitly.
-- ============================================================================

create table attendance_records (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  student_id          uuid not null,
  class_id            uuid not null,
  attendance_date     date not null,
  -- 'full_day' default covers the common one-register-per-day basic-school
  -- case; AM/PM or period registers are also representable via this column
  -- without a schema change.
  session             text not null default 'full_day',
  -- FR-ATT-020.
  status              text not null
                        check (status in ('present','absent','late','excused','sick','suspended','official_activity')),
  -- Offline-sync fields (FR-ATT-010/011). client_id is a device-generated
  -- idempotency key: a retried sync batch (e.g. after a dropped connection
  -- mid-sync) must not create a second row for the same offline entry.
  -- device_timestamp is when the entry was actually recorded on the
  -- device — which may be long before it reaches the server — and is what
  -- the same-user last-write-wins comparison in FR-ATT-011 uses, never the
  -- server receipt time.
  client_id           text,
  device_timestamp    timestamptz not null default now(),
  -- FR-ATT-030: corrections after the submission window retain BOTH
  -- values. original_status is set only on the FIRST correction (see
  -- attendance.service.ts's correct()) so it always holds the true
  -- as-submitted value, not the most recent prior one.
  original_status     text,
  correction_reason   text,
  corrected_at        timestamptz,
  corrected_by        uuid,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  deleted_at          timestamptz,
  deleted_by          uuid,
  unique (tenant_id, id),
  -- FR-ATT-011's conflict key: at most one current record per
  -- student/class/date/session. A second submission against this same key
  -- is either a same-user LWW update or a different-user conflict —
  -- resolved in application code, never by this constraint directly.
  unique (tenant_id, student_id, class_id, attendance_date, session),
  -- Multiple NULLs are allowed under a unique constraint in Postgres, so
  -- entries submitted without a client_id (e.g. direct API use, not the
  -- offline queue) coexist fine; only real client_ids must be unique.
  unique (tenant_id, client_id),
  foreign key (tenant_id, student_id) references students (tenant_id, id),
  foreign key (tenant_id, class_id) references classes (tenant_id, id)
);
create index idx_attendance_records_tenant on attendance_records (tenant_id);
create index idx_attendance_records_tenant_class_date on attendance_records (tenant_id, class_id, attendance_date);

alter table attendance_records enable row level security;
create policy tenant_isolation_attendance_records on attendance_records
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- FR-ATT-011, second half: "entries created by different users for the
-- same student/date/session are surfaced for manual reconciliation rather
-- than silently overwritten." This table holds the challenger (incoming)
-- values plus a pointer to the current attendance_records row, so a
-- reviewer can compare and pick a resolution — see
-- attendance.service.ts's resolveConflict().
create table attendance_conflicts (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references tenants(id),
  attendance_record_id        uuid not null,
  incoming_status             text not null
                                check (incoming_status in ('present','absent','late','excused','sick','suspended','official_activity')),
  incoming_device_timestamp   timestamptz not null,
  incoming_client_id          text,
  incoming_submitted_by       uuid,
  resolved_at                 timestamptz,
  resolved_by                 uuid,
  resolution                  text check (resolution in ('kept_existing','applied_incoming')),
  created_at                  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, attendance_record_id) references attendance_records (tenant_id, id)
);
create index idx_attendance_conflicts_tenant on attendance_conflicts (tenant_id);
create index idx_attendance_conflicts_tenant_unresolved on attendance_conflicts (tenant_id, resolved_at);

alter table attendance_conflicts enable row level security;
create policy tenant_isolation_attendance_conflicts on attendance_conflicts
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on attendance_records, attendance_conflicts to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
