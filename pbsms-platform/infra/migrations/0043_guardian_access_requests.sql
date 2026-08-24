-- ============================================================================
-- 0043_guardian_access_requests.sql
--
-- Closes the "guardian self-request access" gap from the 2026-08-24 bug-list
-- follow-up: today a guardian can ONLY reach Parent View via a link staff
-- proactively mints (0031_guardian_access.sql) — nothing lets a guardian who
-- was never contacted first ask for one. That mechanism's expiry/revocation
-- already work correctly (confirmed with the user before building this), so
-- this is additive: a public request queue staff triage, not a replacement.
--
-- The hard problem a public, unauthenticated request has to solve: WHICH
-- tenant is this for? There is no JWT, no ?token= — nothing that already
-- resolves a tenant context the way every other authenticated route or
-- Parent View's own PARENT_PATH_PREFIX does. The answer here is the same
-- shape 0007_promotion_documents.sql's verify_document() already
-- established for the identical problem (a public caller, no tenant
-- context): a single, narrow, parameterized SECURITY DEFINER function,
-- never a blanket grant. The specific two facts a legitimate requester
-- already has in hand — the school's own code and their child's admission
-- number — are both already printed on real physical documents (report
-- cards, ID cards, admission letters), so this doesn't invent new exposure;
-- it just requires the same two facts a school would ask a parent for over
-- the phone anyway. `schools.code` gets a genuine UNIQUE constraint here
-- (checked against live seed data first — no collision today) since a
-- public code-only lookup needs it to resolve exactly one school, not just
-- one per tenant.
--
-- Deliberately NOT auto-approved: submit_guardian_access_request() only
-- ever creates a 'pending' row. Approval (creating the real guardian
-- record + link + access grant) stays a staff action via the ordinary
-- GuardiansService, reviewed on the Student Profile's own Guardians tab —
-- same "human in the loop" posture reconciliation's matchSettlementLine()
-- and admissions' possible_duplicate_of flagging already use for
-- something a machine shouldn't silently decide alone.
-- ============================================================================

alter table schools add constraint uq_schools_code unique (code);

create table guardian_access_requests (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  student_id       uuid not null,
  requester_name   text not null,
  requester_phone  text,
  requester_email  text,
  relationship     text,
  message          text,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  review_notes     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id)
);
create index idx_guardian_access_requests_tenant on guardian_access_requests (tenant_id);
create index idx_guardian_access_requests_tenant_status on guardian_access_requests (tenant_id, status);

alter table guardian_access_requests enable row level security;
create policy tenant_isolation_guardian_access_requests on guardian_access_requests
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- Rate limiting: this is a public, unauthenticated WRITE (unlike
-- verify_document(), a read) — an unthrottled version would let anyone
-- flood a school's review queue with junk rows. Same shape
-- document_verify_attempts (0037) already established: the app layer
-- (guardians.service.ts) checks/records an attempt BEFORE calling
-- submit_guardian_access_request(), keyed on school_code+admission_no
-- (not a token — there's no secret to hash here) rather than IP, which
-- isn't reliably available through this stack's request abstraction.
create table guardian_access_request_attempts (
  id             uuid primary key default gen_random_uuid(),
  school_code    text not null,
  admission_no   text not null,
  attempted_at   timestamptz not null default now()
);
create index idx_guardian_access_request_attempts_key on guardian_access_request_attempts (school_code, admission_no, attempted_at);
grant select, insert on guardian_access_request_attempts to pbsms_app;

-- No INSERT grant for pbsms_app — every row is created by the SECURITY
-- DEFINER function below (which, as the migration/owner role, bypasses RLS
-- to write it), never directly by an authenticated tenant request. Staff
-- only ever SELECT (list/review) and UPDATE (approve/reject) an existing
-- row, same least-privilege split guardian_access_grants' own grant list
-- already models for a comparable "system writes, staff reads" table.
grant select, update on guardian_access_requests to pbsms_app;

-- ----------------------------------------------------------------------------
-- submit_guardian_access_request(): the public entry point (tenant.
-- middleware.ts's PUBLIC_PATHS, guardians.controller.ts). Returns the new
-- row's id if a real school+admission-number match was found, or zero rows
-- otherwise — the caller gets one deliberately generic message either way
-- ("could not find a matching student — check the school code and
-- admission number"), never a distinct "wrong school code" vs "wrong
-- admission number" answer, so this can't be used to enumerate which part
-- was right.
-- ----------------------------------------------------------------------------
create or replace function submit_guardian_access_request(
  p_school_code text,
  p_admission_no text,
  p_requester_name text,
  p_requester_phone text,
  p_requester_email text,
  p_relationship text,
  p_message text
)
returns table (id uuid)
language sql
security definer
set search_path = public
as $$
  with matched_school as (
    select s.tenant_id from schools s where s.code = p_school_code and s.deleted_at is null limit 1
  ),
  matched_student as (
    select st.id as student_id, st.tenant_id
    from students st
    join matched_school ms on ms.tenant_id = st.tenant_id
    where st.admission_no = p_admission_no and st.deleted_at is null
    limit 1
  )
  insert into guardian_access_requests (tenant_id, student_id, requester_name, requester_phone, requester_email, relationship, message)
  select tenant_id, student_id, p_requester_name, p_requester_phone, p_requester_email, p_relationship, p_message
  from matched_student
  returning guardian_access_requests.id
$$;

revoke all on function submit_guardian_access_request(text, text, text, text, text, text, text) from public;
grant execute on function submit_guardian_access_request(text, text, text, text, text, text, text) to pbsms_app;

-- ----------------------------------------------------------------------------
-- Sanity check (same one every migration adding a tenant table leaves):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs','users','login_attempts');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
