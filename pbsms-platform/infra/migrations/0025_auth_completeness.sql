-- ============================================================================
-- 0025_auth_completeness.sql
--
-- Implements the rest of SRS v2.1 Chapter 33.2 that Authorization Pass 1
-- (0016) explicitly deferred: SEC-020's "secure reset" and SEC-040's
-- "rotation, timeout and revocation" — Phase B of the original 7-phase
-- remaining-backend plan (independent of the Chapter 3-5 Platform
-- Foundation initiative, A1-A4, which is now fully done).
--
-- SEC-040 literally says "secure session cookies" — this API has never
-- used cookies anywhere; every module built so far is Bearer-JWT, an
-- API-first design consistent with Chapter 34's PWA/offline framing
-- (multiple client types, not one server-rendered session). Not
-- reversing that architecture now — "rotation, timeout and revocation"
-- is implemented via refresh tokens instead, the JWT-equivalent of what
-- the SRS's cookie language is really asking for.
--
-- Two new tables, both in the same "runs before/outside any resolved
-- tenant context" category as `login_attempts` (0016) — NOT tenant-scoped,
-- no RLS, granted directly to pbsms_app since auth.module.ts's
-- AuthService already queries this category of table via the raw
-- PG_POOL, same as login_attempts/login_lookup().
--
--   refresh_tokens — SEC-040. Only a HASH is stored (sha256), same
--   "never store the literal secret" principle as password_hash itself.
--   Rotation with reuse detection: refreshing a token marks it revoked
--   and links replaced_by_id to the new one; presenting an
--   ALREADY-REVOKED token again (a classic stolen-token signal) makes
--   auth.service.ts revoke every other active refresh token for that
--   user, not just reject the one request — the standard rotation-abuse
--   response.
--
--   password_reset_tokens — SEC-020's "secure reset." Short-lived
--   (service-enforced 1 hour), single-use (used_at). Real email
--   delivery of the reset link is out of scope for the identical reason
--   dunning notifications are (0024_billing.sql's header) — no
--   WhatsApp/SMS/SMTP integration exists yet (Appendix E) — the token
--   generation/validation/consumption logic is fully real regardless.
-- ============================================================================

create table refresh_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id),
  token_hash      text not null,
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  replaced_by_id  uuid references refresh_tokens(id)
);
create index idx_refresh_tokens_user on refresh_tokens (user_id);
create unique index uq_refresh_tokens_hash on refresh_tokens (token_hash);

grant select, insert, update on refresh_tokens to pbsms_app;

create table password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id),
  token_hash  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index idx_password_reset_tokens_user on password_reset_tokens (user_id);
create unique index uq_password_reset_tokens_hash on password_reset_tokens (token_hash);

grant select, insert, update on password_reset_tokens to pbsms_app;

-- ----------------------------------------------------------------------------
-- Sanity checks to run manually after applying this file:
--
-- 1. Neither table has RLS (correct — same category as login_attempts):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname IN ('refresh_tokens', 'password_reset_tokens');
-- -- should return exactly these 2 rows.
-- ----------------------------------------------------------------------------
