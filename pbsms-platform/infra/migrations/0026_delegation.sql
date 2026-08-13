-- ============================================================================
-- 0026_delegation.sql
--
-- Implements SRS v2.1 Chapter 13.4 (Delegation & Conflict of Interest) —
-- "Temporary authority includes delegator, recipient, exact functions,
-- start, end and automatic expiry; delegation is visible and audited."
-- Second half of Phase C (13.3's class-assignment scoping was the first,
-- built directly into attendance.service.ts/results.service.ts against
-- teacher_assignments — no new migration needed for that half).
--
-- role_delegations is an ORDINARY tenant-owned table (RLS, standard
-- grant to pbsms_app) — unlike Phase A's platform tables, a delegation
-- only ever makes sense between two members of the SAME tenant, so this
-- doesn't need the platform-table/SECURITY DEFINER treatment.
--
-- "exact functions" is modeled as role_codes (text[]) — a delegation
-- hands off one or more specific role codes the delegator ALREADY holds,
-- not an arbitrary permission set. delegations.service.ts enforces "you
-- can only delegate a role you actually hold" — the table itself doesn't
-- (a cross-row check against tenant_users, same reasoning module-pattern
-- rule 3 gives for keeping business rules in the service, not a
-- constraint).
--
-- No maximum duration CHECK (unlike TEN-021's explicit 2-hour cap for
-- impersonation) — Chapter 13.4 doesn't specify one, and inventing an
-- arbitrary cap not asked for would be the same mistake as hardcoding an
-- unrequested business rule elsewhere in this codebase.
-- ============================================================================

create table role_delegations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  delegator_id uuid not null references users(id),
  recipient_id uuid not null references users(id),
  role_codes   text[] not null,
  reason       text,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  revoked_at   timestamptz,
  revoked_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  check (ends_at > starts_at),
  check (delegator_id <> recipient_id),
  check (array_length(role_codes, 1) > 0)
);
create index idx_role_delegations_tenant on role_delegations (tenant_id);
create index idx_role_delegations_recipient on role_delegations (tenant_id, recipient_id);

alter table role_delegations enable row level security;
create policy tenant_isolation_role_delegations on role_delegations
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update on role_delegations to pbsms_app;

-- ----------------------------------------------------------------------------
-- Sanity check to run manually after applying this file:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN (<the full platform-table exclusion list — see
-- .github/workflows/ci.yml's own list, which this migration does NOT add
-- to, since role_delegations correctly DOES get RLS>);
-- -- role_delegations should NOT appear in the leaky-table results.
-- ----------------------------------------------------------------------------
