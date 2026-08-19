-- ============================================================================
-- 0035_transport_gps.sql
--
-- Closes the one piece of SRS v2.1 Chapter 28 (FR-OPS-020) that
-- 0013_transport.sql's header explicitly deferred: "GPS-based arrival
-- notification." No GPS hardware/vendor account exists in this environment
-- (same class of deferral as WhatsApp/SMS/payment providers) — but unlike
-- those, arrival proximity is pure geometry once a location exists, so this
-- builds the real seam any device or driver-facing app could call, tested
-- with manually-entered coordinates, same "the seam is real, the wiring
-- behind it can come later" reasoning 0034_settlement_reconciliation.sql
-- already established for provider-settlement data.
--
-- Scope notes:
--   - transport_stops gains optional lat/lng — optional because not every
--     school will geo-locate every stop immediately; a stop with no
--     coordinates simply never participates in an arrival check.
--   - transport_vehicle_locations is an append-only ping log (no UPDATE/
--     DELETE grant, same posture as audit_log) — one row per reported
--     position, never mutated or backfilled.
--   - transport_stop_arrivals exists purely to debounce notifications: a
--     vehicle lingering near a stop for several pings must not re-notify
--     guardians every single ping. One row per (vehicle, stop) arrival
--     event that actually triggered a notification; transport.service.ts's
--     recordVehicleLocation() checks this table for a recent row before
--     firing again, application-level cooldown, not a DB constraint,
--     since "recent" is a business rule (minutes), not a uniqueness rule.
-- ============================================================================

alter table transport_stops add column latitude numeric(9, 6);
alter table transport_stops add column longitude numeric(9, 6);

create table transport_vehicle_locations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  vehicle_id   uuid not null,
  latitude     numeric(9, 6) not null,
  longitude    numeric(9, 6) not null,
  recorded_at  timestamptz not null default now(),
  reported_by  uuid not null,
  unique (tenant_id, id),
  foreign key (tenant_id, vehicle_id) references transport_vehicles (tenant_id, id)
);
create index idx_transport_vehicle_locations_tenant on transport_vehicle_locations (tenant_id);
create index idx_transport_vehicle_locations_tenant_vehicle_time
  on transport_vehicle_locations (tenant_id, vehicle_id, recorded_at desc);

alter table transport_vehicle_locations enable row level security;
create policy tenant_isolation_transport_vehicle_locations on transport_vehicle_locations
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- Append-only: pbsms_app gets select+insert only, matching audit_log's
-- grant shape (0016_authorization.sql) — a position ping is never edited
-- or retracted once reported.
grant select, insert on transport_vehicle_locations to pbsms_app;

create table transport_stop_arrivals (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  vehicle_id   uuid not null,
  stop_id      uuid not null,
  notified_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, vehicle_id) references transport_vehicles (tenant_id, id),
  foreign key (tenant_id, stop_id) references transport_stops (tenant_id, id)
);
create index idx_transport_stop_arrivals_tenant on transport_stop_arrivals (tenant_id);
create index idx_transport_stop_arrivals_lookup
  on transport_stop_arrivals (tenant_id, vehicle_id, stop_id, notified_at desc);

alter table transport_stop_arrivals enable row level security;
create policy tenant_isolation_transport_stop_arrivals on transport_stop_arrivals
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert on transport_stop_arrivals to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
