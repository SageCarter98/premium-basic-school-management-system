-- ============================================================================
-- 0033_timetable.sql
--
-- Implements SRS v2.1 Chapter 17's Timetable builder/views (spec §7.6) and
-- FR-ACA-040 (teacher/class/room timetable-conflict detection) — the gap
-- 0020_teacher_assignments.sql's own header and apps/web/README.md's Stage
-- 5 section both flagged as "genuinely blocked, no periods/rooms/timetable
-- table anywhere in this schema."
--
-- Scope notes (read before extending this):
--   - Same academic_year_id-stands-in-for-"term" simplification
--     0004_assessment.sql and 0020_teacher_assignments.sql already made —
--     this schema still has no `terms` table. day_of_week is a plain text
--     enum ('monday'..'saturday') rather than a date, since a timetable
--     slot repeats weekly for the whole academic year, not a one-off date.
--   - `periods` are tenant-wide time-of-day templates (e.g. "Period 1,
--     08:00-08:40"), not day-specific — the same period id is reused across
--     every day_of_week a class meets at that slot.
--   - FR-ACA-040's conflict detection is enforced as THREE partial unique
--     indexes below (teacher/class/room each can't be double-booked in the
--     same academic_year+day+period), the same "no duplicate active slot"
--     shape 0020_teacher_assignments.sql's uq_teacher_assignments_active_slot
--     already established — a single-row uniqueness rule, not a cross-row
--     aggregate check, so a DB constraint is the right tool (module-pattern
--     rule 3), not a service-level BEGIN/COMMIT check. timetable.service.ts
--     still pre-checks and raises a clean, conflict-specific 409 naming
--     which of teacher/class/room collided — CREATE FEE STRUCTURE's own
--     known gap (a raw 500 instead of a clean 409 on a DB-level unique
--     violation) is deliberately not repeated here.
--   - room_id is nullable — not every period (e.g. a form period) needs a
--     dedicated room, and this schema has no requirement that one exists.
--   - No is_class_teacher / actual period-to-clock-time occupancy across
--     different day patterns (e.g. alternating-week timetables) — out of
--     scope, same "build what the SRS text actually asks for" posture as
--     0020_teacher_assignments.sql's own deferred-items list.
-- ============================================================================

create table rooms (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  name              text not null,
  capacity          integer check (capacity is null or capacity > 0),
  status            text not null default 'active' check (status in ('active', 'inactive')),
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (tenant_id, id)
);
create index idx_rooms_tenant on rooms (tenant_id);

alter table rooms enable row level security;
create policy tenant_isolation_rooms on rooms
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table periods (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  name              text not null,
  sequence          integer not null check (sequence > 0),
  start_time        time not null,
  end_time          time not null check (end_time > start_time),
  -- 'teaching' is the only type timetable.service.ts's createEntry() will
  -- assign a class+subject+teacher against (a cross-row check, done in the
  -- service per module-pattern rule 3, not a CHECK constraint) —
  -- 'break'/'assembly'/'other' exist purely so a tenant's own day
  -- structure (lunch, assembly, form period) can be represented and shown
  -- on the visual builder without inventing a lookup somewhere else. Each
  -- tenant defines its own full set from scratch (a fresh tenant starts
  -- with zero periods) — nothing here is a hardcoded universal template.
  period_type       text not null default 'teaching' check (period_type in ('teaching', 'break', 'assembly', 'other')),
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (tenant_id, id)
);
create index idx_periods_tenant on periods (tenant_id);

alter table periods enable row level security;
create policy tenant_isolation_periods on periods
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table timetable_entries (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  academic_year_id  uuid not null,
  class_id          uuid not null,
  subject_id        uuid not null,
  teacher_id        uuid not null references users(id),
  period_id         uuid not null,
  room_id           uuid,
  day_of_week       text not null check (day_of_week in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')),
  status            text not null default 'active' check (status in ('active', 'ended')),
  ended_at          timestamptz,
  ended_reason      text,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, academic_year_id) references academic_years (tenant_id, id),
  foreign key (tenant_id, class_id) references classes (tenant_id, id),
  foreign key (tenant_id, subject_id) references subjects (tenant_id, id),
  foreign key (tenant_id, period_id) references periods (tenant_id, id),
  foreign key (tenant_id, room_id) references rooms (tenant_id, id)
);
create index idx_timetable_entries_tenant on timetable_entries (tenant_id);
create index idx_timetable_entries_tenant_class on timetable_entries (tenant_id, class_id, academic_year_id);
create index idx_timetable_entries_tenant_teacher on timetable_entries (tenant_id, teacher_id, academic_year_id);

-- FR-ACA-040: a teacher, a class, and a room can each hold at most one
-- ACTIVE entry for the same academic_year+day+period. Three separate
-- indexes because each is a genuinely different conflict (a teacher
-- double-booked across two classes; a class double-booked across two
-- subjects; a room double-booked across two classes), not one combined rule.
create unique index uq_timetable_teacher_slot
  on timetable_entries (tenant_id, teacher_id, academic_year_id, day_of_week, period_id)
  where status = 'active';
create unique index uq_timetable_class_slot
  on timetable_entries (tenant_id, class_id, academic_year_id, day_of_week, period_id)
  where status = 'active';
create unique index uq_timetable_room_slot
  on timetable_entries (tenant_id, room_id, academic_year_id, day_of_week, period_id)
  where status = 'active' and room_id is not null;

alter table timetable_entries enable row level security;
create policy tenant_isolation_timetable_entries on timetable_entries
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on rooms, periods, timetable_entries to pbsms_app;

alter table rooms add constraint rooms_created_by_fkey foreign key (created_by) references users(id);
alter table rooms add constraint rooms_updated_by_fkey foreign key (updated_by) references users(id);
alter table periods add constraint periods_created_by_fkey foreign key (created_by) references users(id);
alter table periods add constraint periods_updated_by_fkey foreign key (updated_by) references users(id);
alter table timetable_entries add constraint timetable_entries_created_by_fkey foreign key (created_by) references users(id);
alter table timetable_entries add constraint timetable_entries_updated_by_fkey foreign key (updated_by) references users(id);

-- ----------------------------------------------------------------------------
-- Sanity checks to run manually after applying this file:
--
-- 1. RLS enabled:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname IN ('rooms', 'periods', 'timetable_entries');
-- -- should return zero rows.
-- ----------------------------------------------------------------------------
