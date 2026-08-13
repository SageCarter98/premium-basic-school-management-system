-- ============================================================================
-- 0015_inventory.sql
--
-- Implements SRS v2.1 Chapter 28 (FR-OPS-050): "asset register, stock
-- levels, issuance tracking, low-stock alerts feeding the notification
-- engine." Last of Chapter 28's five domains.
--
-- Scope notes (read before extending this):
--   - inventory_issuances.issued_to_id follows the same generic,
--     un-FK'd recipient shape used everywhere else in this codebase
--     (communication's notifications, discipline/health's guardian
--     contacts) — no dedicated staff table exists, and a student
--     recipient doesn't need to prove FK integrity any more strictly
--     here than those other un-FK'd actor columns do.
--   - Low-stock alerting (FR-OPS-050's own phrase) is the third module
--     to call CommunicationService directly, after Discipline and
--     Health — but with sensitivity 'normal', not 'confidential': this
--     is stock data, not a person's record, so FR-COM-050's stricter-
--     minimization rule does not apply. inventory.service.ts's
--     issueStock() requires the caller to supply the alert recipient's
--     contact details directly (same "no real staff/role directory to
--     look up a Storekeeper from" reasoning as discipline's
--     contactGuardian()) — if omitted, issuance still succeeds, it just
--     doesn't alert anyone even if stock crosses the threshold.
-- ============================================================================

create table inventory_items (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  name               text not null,
  category           text,
  unit               text not null default 'each',
  quantity_on_hand   integer not null check (quantity_on_hand >= 0),
  reorder_threshold  integer not null default 0 check (reorder_threshold >= 0),
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  unique (tenant_id, id)
);
create index idx_inventory_items_tenant on inventory_items (tenant_id);

alter table inventory_items enable row level security;
create policy tenant_isolation_inventory_items on inventory_items
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table inventory_issuances (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  item_id         uuid not null,
  issued_to_type  text not null check (issued_to_type in ('student', 'staff')),
  issued_to_id    uuid not null,   -- no FK: see header
  quantity        integer not null check (quantity > 0),
  issued_by       uuid not null,
  issued_at       timestamptz not null default now(),
  purpose         text,
  unique (tenant_id, id),
  foreign key (tenant_id, item_id) references inventory_items (tenant_id, id)
);
create index idx_inventory_issuances_tenant on inventory_issuances (tenant_id);
create index idx_inventory_issuances_tenant_item on inventory_issuances (tenant_id, item_id);

alter table inventory_issuances enable row level security;
create policy tenant_isolation_inventory_issuances on inventory_issuances
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table inventory_alerts (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  item_id            uuid not null,
  quantity_on_hand   integer not null,
  reorder_threshold  integer not null,
  notification_id    uuid,
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, item_id) references inventory_items (tenant_id, id),
  foreign key (tenant_id, notification_id) references notifications (tenant_id, id)
);
create index idx_inventory_alerts_tenant on inventory_alerts (tenant_id);
create index idx_inventory_alerts_tenant_item on inventory_alerts (tenant_id, item_id);

alter table inventory_alerts enable row level security;
create policy tenant_isolation_inventory_alerts on inventory_alerts
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on inventory_items, inventory_issuances, inventory_alerts to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
