-- ============================================================================
-- 0027_background_jobs.sql
--
-- Implements SRS v2.1 Chapter 35.1 (Background Jobs, FR-JOB-010..030) —
-- Phase D of the multi-phase completion plan (D of A-G; see README's
-- "Where to go next"). Chosen mechanism: a Postgres-backed queue (no
-- Redis/Bull), confirmed with the user first — this environment has no
-- Docker and no Redis running (only an unused REDIS_URL env var), and a
-- plain jobs table + `FOR UPDATE SKIP LOCKED` polling worker needs no new
-- infrastructure, matching this codebase's existing "avoid a new dep where
-- avoidable" pattern (hand-rolled TOTP, etc.).
--
-- Two tables, both ordinary RLS'd tenant tables (a job/schedule always
-- belongs to exactly one tenant, unlike Phase A's platform tables):
--
--   1. `background_jobs` — the queue itself. FR-JOB-030's exact fields
--      (tenant_id, start, end, outcome, retry count, dead-letter path) are
--      columns, not something bolted on afterward.
--   2. `job_schedules` — FR-JOB-010's recurring definitions (one_time /
--      daily / weekly / monthly / termly / yearly). 'event_triggered' from
--      FR-JOB-010's list deliberately has NO schedule row: there is nothing
--      to evaluate on a timer for an event trigger — the triggering code
--      path (e.g. billing.service.ts's runDunningStep()) enqueues directly
--      into background_jobs instead. Documented modeling decision, not an
--      oversight — same shape as Chapter 4.1's transition graph or
--      Chapter 13.3's scope hierarchy needing a judgment call because the
--      SRS names the categories but not the mechanism.
--
-- 'termly' schedules advance by a fixed ~4-month interval — this schema
-- still has no real `terms` table (same simplification 0004/0020 already
-- documented for assessment_structures/teacher_assignments).
--
-- THE HARD PART: FR-JOB-020 requires bulk jobs run "on the dedicated
-- worker pool, never on request-serving capacity" — and the worker must
-- dequeue jobs across ALL tenants (it doesn't know which tenant's job is
-- next until it looks), while background_jobs is RLS'd per-tenant like
-- every other tenant table. A worker connection can never set
-- app.current_tenant ahead of time for this reason — same shape as Phase
-- A2/A3's "platform role reading tenant-owned data" problem, and the same
-- lesson applies: a plain GRANT on an RLS'd table for a role that never
-- sets app.current_tenant compiles, runs, and silently returns nothing
-- (module-pattern lesson #5). So a THIRD restricted role, `pbsms_worker`,
-- gets ZERO plain table grants — only EXECUTE on three narrow SECURITY
-- DEFINER functions below, mirroring pbsms_platform's shape exactly.
-- ============================================================================

create table background_jobs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  job_type        text not null,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'queued'
                    constraint background_jobs_status_check check (status in ('queued','running','succeeded','failed','dead_letter')),
  scheduled_for   timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  attempt_count   integer not null default 0,
  max_attempts    integer not null default 3,
  last_error      text,
  created_at      timestamptz not null default now(),
  created_by      uuid references users(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references users(id),
  unique (tenant_id, id)
);
create index idx_background_jobs_tenant on background_jobs (tenant_id);
-- Dequeue candidate lookup is cross-tenant by nature (the worker doesn't
-- know the tenant yet) — this index is deliberately NOT tenant-led, unlike
-- every other index in this codebase, because dequeue_next_job() below
-- bypasses RLS entirely via SECURITY DEFINER and scans across tenants.
create index idx_background_jobs_dequeue on background_jobs (status, scheduled_for) where status = 'queued';

alter table background_jobs enable row level security;
create policy tenant_isolation_background_jobs on background_jobs
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table job_schedules (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  job_type          text not null,
  payload_template  jsonb not null default '{}'::jsonb,
  frequency         text not null
                      constraint job_schedules_frequency_check check (frequency in ('one_time','daily','weekly','monthly','termly','yearly')),
  -- day_of_week/day_of_month are caller-declared INTENT metadata only
  -- ("this is meant to be a Monday job") — evaluate_due_schedules() below
  -- does not read them; it advances next_run_at by a fixed calendar
  -- interval instead (documented simplification, see create-schedule.dto.ts).
  day_of_week       integer check (day_of_week between 0 and 6),   -- only meaningful when frequency = 'weekly' (0 = Sunday)
  day_of_month      integer check (day_of_month between 1 and 31), -- only meaningful when frequency in ('monthly','yearly')
  next_run_at       timestamptz not null,
  last_run_at       timestamptz,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid references users(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references users(id)
);
create index idx_job_schedules_tenant on job_schedules (tenant_id);
create index idx_job_schedules_due on job_schedules (is_active, next_run_at) where is_active;

alter table job_schedules enable row level security;
create policy tenant_isolation_job_schedules on job_schedules
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- ============================================================================
-- pbsms_worker — the third restricted role (after pbsms_app, pbsms_platform).
-- Mirrors 0021_tenant_lifecycle.sql's "RESTRICTED APPLICATION ROLE" pattern
-- exactly: owns nothing, not a superuser, so it would see zero rows on a
-- plain SELECT against an RLS'd table — which is exactly why it gets no
-- plain grants at all, only EXECUTE on the three functions below.
-- ============================================================================

do $$
begin
  if not exists (select from pg_catalog.pg_roles where rolname = 'pbsms_worker') then
    create role pbsms_worker with login password 'pbsms_worker_local_only';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- System service account — needed because 0018_staff_directory.sql FK'd
-- every created_by/updated_by-shaped actor column to users(id), including
-- notifications/generated_documents' equivalents that job handlers write
-- to. Most jobs execute with a REAL human actor (background_jobs.created_by,
-- carried through from whoever called JobsService.enqueue() or created the
-- owning job_schedules row — a real, JWT-authenticated user by
-- construction). But platform_enqueue_job() (used by billing.service.ts's
-- runDunningStep(), a platform-context call with no human in the loop for
-- that specific action) leaves created_by null — job handlers for that
-- case need a real, valid users(id) to satisfy those FKs. This fixed-id
-- row is that actor: is_platform_user=true (never eligible for a
-- tenant_users row, TEN-013's pattern), a real argon2 hash of a random
-- 24-byte value that was generated once and discarded (never recorded
-- anywhere) — so login_lookup() still behaves exactly as it does for any
-- other row (a wrong password returns false, never throws), but no
-- password that produces a match exists for anyone to enter. Not a demo
-- fixture (seed_demo.sql's job): every environment, including production,
-- needs this row before any job can run.
-- ----------------------------------------------------------------------------
insert into users (id, email, password_hash, full_name, is_platform_user)
values (
  '00000000-0000-0000-0000-000000000001',
  'system@pbsms.internal',
  '$argon2id$v=19$m=65536,t=3,p=4$UrrKtaSCp6TadN3aP7hwUg$KJntdtG2e4O/lsy4ePZ/MjZ786HTKkysq3ti+fn2HEs',
  'PBSMS Background Worker',
  true
)
on conflict (id) do nothing;

-- pbsms_worker needs USAGE on schema public to resolve ANY object in it,
-- including the SECURITY DEFINER functions below by plain unqualified name
-- — normally granted to PUBLIC by default for the built-in public schema,
-- but explicit here rather than assumed: this environment's public schema
-- was previously DROP/CREATE'd during a schema reset (see 0001's own
-- "RESTRICTED APPLICATION ROLE" section's sanity-check note), which does
-- NOT restore the default PUBLIC grant, only the owner's — pbsms_app/
-- pbsms_platform had this re-granted by hand in a past session, but a
-- brand-new role created here would silently inherit nothing. Caught live:
-- a direct `select * from dequeue_next_job()` as pbsms_worker failed with
-- "function ... does not exist" (not a permission-denied error) despite
-- the function genuinely existing in pg_proc — Postgres's error for
-- "can't resolve this name via your search_path" looks identical to
-- "doesn't exist" from the caller's side, same category of misleading
-- failure as the RLS-silently-returns-zero-rows lesson from Phase A2.
grant usage on schema public to pbsms_worker;

-- ----------------------------------------------------------------------------
-- dequeue_next_job(): atomically claims the single oldest due job across
-- ALL tenants. `for update skip locked` is the standard Postgres queue
-- pattern — a second concurrent worker (or a future multi-worker
-- deployment) skips a row another worker already has locked instead of
-- blocking on it or double-claiming it.
-- ----------------------------------------------------------------------------
-- created_by is included so the worker can run each job's handler as the
-- REAL requesting user (TenantContextStore) rather than a generic system
-- actor — a report_card_batch a headmaster requested should attribute the
-- resulting generated_documents rows to that headmaster, not to
-- "PBSMS Background Worker," matching what an equivalent direct HTTP call
-- would have recorded. Only platform_enqueue_job()'s jobs (created_by
-- null — no human in that loop, e.g. 'dunning_notification') fall back to
-- the system service account, handled in worker.ts, not here.
create function dequeue_next_job()
returns table (
  id uuid,
  tenant_id uuid,
  job_type text,
  payload jsonb,
  attempt_count integer,
  max_attempts integer,
  created_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update background_jobs
  set status = 'running', started_at = now(), attempt_count = background_jobs.attempt_count + 1
  where background_jobs.id = (
    select bj.id from background_jobs bj
    where bj.status = 'queued' and bj.scheduled_for <= now()
    order by bj.scheduled_for asc
    for update skip locked
    limit 1
  )
  returning background_jobs.id, background_jobs.tenant_id, background_jobs.job_type, background_jobs.payload,
            background_jobs.attempt_count, background_jobs.max_attempts, background_jobs.created_by;
end;
$$;

revoke all on function dequeue_next_job() from public;
grant execute on function dequeue_next_job() to pbsms_worker;

-- ----------------------------------------------------------------------------
-- complete_job(): records the outcome (FR-JOB-030). On failure, retries
-- with exponential backoff (2^attempt_count minutes) until max_attempts is
-- exhausted, then routes to 'dead_letter' — FR-JOB-030's dead-letter path
-- "with alerting" is satisfied by writing a real audit_log row for the
-- owning tenant at that moment (owner-role bypass, same SECURITY DEFINER
-- trick record_platform_action_in_tenant_audit() already established),
-- not a stub notification pretending to page someone — actual
-- email/SMS/WhatsApp alerting is blocked on the same Appendix E vendor
-- onboarding gate as every other messaging integration in this codebase.
-- ----------------------------------------------------------------------------
create function complete_job(p_job_id uuid, p_succeeded boolean, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_attempt_count integer;
  v_max_attempts integer;
begin
  if p_succeeded then
    update background_jobs
    set status = 'succeeded', completed_at = now(), last_error = null
    where id = p_job_id;
    return;
  end if;

  select tenant_id, attempt_count, max_attempts into v_tenant_id, v_attempt_count, v_max_attempts
  from background_jobs where id = p_job_id;

  if v_attempt_count < v_max_attempts then
    update background_jobs
    set status = 'queued', scheduled_for = now() + make_interval(mins => power(2, v_attempt_count)::int), last_error = p_error
    where id = p_job_id;
  else
    update background_jobs
    set status = 'dead_letter', completed_at = now(), last_error = p_error
    where id = p_job_id;

    insert into audit_log (tenant_id, actor_user_id, actor_role_codes, action, method, path, status_code, detail)
    values (v_tenant_id, null, array['system']::text[], 'job_dead_letter', 'WORKER', '/internal/jobs/' || p_job_id, 500,
            jsonb_build_object('jobId', p_job_id, 'attempts', v_attempt_count, 'error', p_error));
  end if;
end;
$$;

revoke all on function complete_job(uuid, boolean, text) from public;
grant execute on function complete_job(uuid, boolean, text) to pbsms_worker;

-- ----------------------------------------------------------------------------
-- evaluate_due_schedules(): finds every active schedule whose next_run_at
-- has passed, enqueues the corresponding background_jobs row, and advances
-- next_run_at (or deactivates a one_time schedule — it has no next
-- occurrence). Same cross-tenant-scan-needs-bypass reasoning as
-- dequeue_next_job(). Returns the count enqueued so the worker loop can log
-- something meaningful.
-- ----------------------------------------------------------------------------
create function evaluate_due_schedules()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
  v_next timestamptz;
begin
  for v_row in
    select * from job_schedules
    where is_active and next_run_at <= now()
    for update skip locked
  loop
    insert into background_jobs (tenant_id, job_type, payload, scheduled_for, created_by)
    values (v_row.tenant_id, v_row.job_type, v_row.payload_template, now(), v_row.created_by);
    v_count := v_count + 1;

    v_next := case v_row.frequency
      when 'one_time' then null
      when 'daily'    then v_row.next_run_at + interval '1 day'
      when 'weekly'   then v_row.next_run_at + interval '7 days'
      when 'monthly'  then v_row.next_run_at + interval '1 month'
      when 'termly'   then v_row.next_run_at + interval '4 months' -- documented simplification: no real terms table yet
      when 'yearly'   then v_row.next_run_at + interval '1 year'
    end;

    if v_next is null then
      update job_schedules set is_active = false, last_run_at = now() where id = v_row.id;
    else
      update job_schedules set next_run_at = v_next, last_run_at = now() where id = v_row.id;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function evaluate_due_schedules() from public;
grant execute on function evaluate_due_schedules() to pbsms_worker;

-- ----------------------------------------------------------------------------
-- platform_enqueue_job(): lets pbsms_platform-scoped code (billing.service.ts's
-- runDunningStep(), which runs off PLATFORM_POOL, never sets
-- app.current_tenant) enqueue a job for a specific tenant despite
-- background_jobs being RLS'd — same narrow-bypass shape as every other
-- platform-reads/writes-tenant-data function in this codebase (A2's
-- lesson, applied proactively here rather than discovered by testing).
-- This is the concrete piece that finally closes A4's documented
-- deferral: FR-BIL-040's "notified by email and WhatsApp" half of dunning,
-- previously blocked because a platform-context request had no safe way
-- to reach a tenant's CommunicationService (Authorization Pass 1's
-- Scope.REQUEST bug risk) — now it just enqueues a 'dunning_notification'
-- job and the worker (which builds its own manually-scoped connection,
-- never Nest's Scope.REQUEST) handles the rest.
-- ----------------------------------------------------------------------------
create function platform_enqueue_job(p_tenant_id uuid, p_job_type text, p_payload jsonb, p_scheduled_for timestamptz default now())
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into background_jobs (tenant_id, job_type, payload, scheduled_for)
  values (p_tenant_id, p_job_type, p_payload, p_scheduled_for)
  returning id
$$;

revoke all on function platform_enqueue_job(uuid, text, jsonb, timestamptz) from public;
grant execute on function platform_enqueue_job(uuid, text, jsonb, timestamptz) to pbsms_platform;

-- ============================================================================
-- pbsms_app grants — ordinary tenant-scoped access, same as every other
-- feature module. A tenant user can request a one-time job (e.g. "generate
-- this class's report cards now"), list/read their own tenant's job
-- history, and manage their own recurring schedules. No access to
-- dequeue_next_job()/complete_job()/evaluate_due_schedules() — those are
-- pbsms_worker-only, same defense-in-depth every privileged function in
-- this codebase already follows.
-- ============================================================================

grant select, insert, update on background_jobs, job_schedules to pbsms_app;

-- ----------------------------------------------------------------------------
-- Sanity checks to run manually after applying this file:
--
-- 1. background_jobs/job_schedules have RLS enabled (both are ordinary
--    tenant tables, unlike Phase A's platform tables):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs','users','login_attempts');
-- -- should still return zero rows (unchanged from prior migrations).
--
-- 2. pbsms_worker has EXECUTE on exactly the three functions and NOTHING
--    else (no table grants at all):
-- SELECT routine_name FROM information_schema.role_routine_grants WHERE grantee = 'pbsms_worker';
-- SELECT table_name FROM information_schema.role_table_grants WHERE grantee = 'pbsms_worker'; -- must return zero rows
-- ----------------------------------------------------------------------------
