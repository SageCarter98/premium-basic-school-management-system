-- ============================================================================
-- 0013_transport.sql
--
-- Implements SRS v2.1 Chapter 28 (FR-OPS-020): "route and stop management,
-- vehicle and driver records, student-route assignment, optional GPS-based
-- arrival notification integration." Third of Chapter 28's five domains.
--
-- Scope notes (read before extending this):
--   - GPS-based arrival notification (FR-OPS-020's own "optional...
--     integration") is NOT built — no vendor/device account exists in this
--     environment (same class of deferral as WhatsApp/SMS/payment
--     providers), and nothing else in this migration depends on it, so no
--     schema stub is needed either.
--   - transport_student_assignments' partial unique index (one active
--     assignment per student) mirrors notification_templates' one-active-
--     version index (0010) — assignStudentToRoute() in
--     transport.service.ts supersedes any existing active assignment in
--     the same transaction it creates the new one, the same shape as
--     communication.createTemplate().
-- ============================================================================

create table transport_routes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  name         text not null,
  description  text,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  unique (tenant_id, id)
);
create index idx_transport_routes_tenant on transport_routes (tenant_id);

alter table transport_routes enable row level security;
create policy tenant_isolation_transport_routes on transport_routes
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table transport_stops (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  route_id     uuid not null,
  name         text not null,
  sequence_no  integer not null check (sequence_no >= 1),
  created_at   timestamptz not null default now(),
  created_by   uuid,
  unique (tenant_id, id),
  unique (tenant_id, route_id, sequence_no),
  foreign key (tenant_id, route_id) references transport_routes (tenant_id, id)
);
create index idx_transport_stops_tenant on transport_stops (tenant_id);
create index idx_transport_stops_tenant_route on transport_stops (tenant_id, route_id);

alter table transport_stops enable row level security;
create policy tenant_isolation_transport_stops on transport_stops
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table transport_vehicles (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  registration_no  text not null,
  capacity         integer not null check (capacity > 0),
  route_id         uuid,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  unique (tenant_id, id),
  unique (tenant_id, registration_no),
  foreign key (tenant_id, route_id) references transport_routes (tenant_id, id)
);
create index idx_transport_vehicles_tenant on transport_vehicles (tenant_id);

alter table transport_vehicles enable row level security;
create policy tenant_isolation_transport_vehicles on transport_vehicles
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table transport_drivers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  name         text not null,
  license_no   text not null,
  phone        text,
  vehicle_id   uuid,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, vehicle_id) references transport_vehicles (tenant_id, id)
);
create index idx_transport_drivers_tenant on transport_drivers (tenant_id);

alter table transport_drivers enable row level security;
create policy tenant_isolation_transport_drivers on transport_drivers
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table transport_student_assignments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  student_id   uuid not null,
  route_id     uuid not null,
  stop_id      uuid not null,
  status       text not null default 'active' check (status in ('active', 'ended')),
  start_date   date not null default current_date,
  end_date     date,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id),
  foreign key (tenant_id, route_id) references transport_routes (tenant_id, id),
  foreign key (tenant_id, stop_id) references transport_stops (tenant_id, id)
);
create index idx_transport_assignments_tenant on transport_student_assignments (tenant_id);
create index idx_transport_assignments_tenant_student on transport_student_assignments (tenant_id, student_id);

-- FR-OPS-020: at most one active route assignment per student — mirrors
-- 0010_communication.sql's idx_notification_templates_one_active.
create unique index idx_transport_assignments_one_active
  on transport_student_assignments (tenant_id, student_id)
  where status = 'active';

alter table transport_student_assignments enable row level security;
create policy tenant_isolation_transport_student_assignments on transport_student_assignments
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on
  transport_routes, transport_stops, transport_vehicles, transport_drivers, transport_student_assignments
to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
