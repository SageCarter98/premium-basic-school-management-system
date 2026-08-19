-- ============================================================================
-- Stage 6 (Parent View, spec §6.3/§8.6): the ONE mechanism the whole
-- surface depends on — a guardian reaching their child's data with "no
-- login wall... reached via an authenticated link" (spec's own words).
-- Guardians have no `users`/`tenant_users` row (TEN-013-adjacent — they
-- were never modeled as authenticatable actors, see 0019_guardians.sql),
-- so this cannot reuse the Bearer-JWT session model every other actor
-- kind in this codebase uses. It follows the SAME shape
-- verify_document() (0007_promotion_documents.sql) already established
-- for "a caller with no tenant context, verified by a possession-based
-- token": a narrow SECURITY DEFINER function, never a blanket grant.
--
-- One real difference from verify_document(): a document's
-- verification_token is stored PLAINTEXT and is meant to be shared
-- openly (it only confirms a document's authenticity to a third party).
-- A guardian access token grants ongoing READ access to a child's
-- private results/finance data — closer in sensitivity to
-- refresh_tokens/password_reset_tokens (0025_auth_completeness.sql) than
-- to a document reference number, so it follows THEIR pattern instead:
-- hash-only storage (sha256, computed in application code before ever
-- reaching this table), never the literal secret at rest.
-- ============================================================================

create table guardian_access_grants (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  guardian_id   uuid not null,
  token_hash    text not null,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  foreign key (tenant_id, guardian_id) references guardians (tenant_id, id)
);
create index idx_guardian_access_grants_tenant on guardian_access_grants (tenant_id);
create index idx_guardian_access_grants_guardian on guardian_access_grants (tenant_id, guardian_id);
create unique index uq_guardian_access_grants_hash on guardian_access_grants (token_hash);

alter table guardian_access_grants enable row level security;
create policy tenant_isolation_guardian_access_grants on guardian_access_grants
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update on guardian_access_grants to pbsms_app;

-- ----------------------------------------------------------------------------
-- verify_guardian_access(): the anonymous-caller entry point, mirroring
-- verify_document()/login_lookup()'s exact SECURITY DEFINER shape — owned
-- by the migration role (which, as table owner, bypasses RLS), so
-- pbsms_app can call it with NO app.current_tenant set at all. Bumps
-- last_used_at atomically in the same statement (UPDATE ... RETURNING)
-- rather than a separate write, since the caller has no tenant context to
-- perform that write through the normal RLS-scoped path afterward — this
-- function is the only place that can do it.
-- ----------------------------------------------------------------------------
create or replace function verify_guardian_access(p_token_hash text)
returns table (
  guardian_id uuid,
  tenant_id   uuid
)
language sql
security definer
set search_path = public
as $$
  update guardian_access_grants
  set last_used_at = now()
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > now()
  returning guardian_access_grants.guardian_id, guardian_access_grants.tenant_id
$$;

revoke all on function verify_guardian_access(text) from public;
grant execute on function verify_guardian_access(text) to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs (guardian_access_grants
-- -- has real per-tenant data behind it, unlike users/login_attempts/audit_log's
-- -- platform-adjacent category — it belongs on the RLS'd side).
--
-- Extra sanity check specific to this migration — confirm
-- verify_guardian_access() works with NO tenant context set, and that it
-- correctly rejects an expired/revoked/unknown hash:
-- \c pbsms pbsms_app
-- RESET app.current_tenant;
-- SELECT * FROM verify_guardian_access('<a real sha256 hex hash>');
-- -- should return one row despite no app.current_tenant being set, while
-- -- SELECT * FROM guardian_access_grants; in the same session returns zero.
-- ----------------------------------------------------------------------------
