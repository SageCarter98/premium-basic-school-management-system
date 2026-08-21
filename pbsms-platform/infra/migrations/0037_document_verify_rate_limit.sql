-- ============================================================================
-- 0037_document_verify_rate_limit.sql
--
-- Closes a flagged gap: GET /v1/documents/verify (FR-DOC-020) is this
-- codebase's first genuinely public, unauthenticated endpoint — and the
-- only one with no rate limit at all. Mirrors auth.module.ts's login
-- rate-limiter shape exactly (login_attempts, 0016_authorization.sql):
-- a plain attempts log, not tenant-scoped (this route runs before any
-- tenant context exists — same category as login_attempts/refresh_tokens),
-- checked via a recent-attempts count rather than a token-bucket/Redis
-- mechanism, since that's already the proven pattern here and this
-- environment has no Redis running.
--
-- Keyed on a HASH of the presented token, not the raw token — same
-- "never store the literal secret at rest" principle as
-- refresh_tokens.token_hash/password_reset_tokens.token_hash, even though
-- a verification_token is not itself a login credential (it only grants
-- read access to non-revoked-status metadata about one document).
--
-- Threshold is deliberately looser than login's 5/15min (RATE_LIMIT_MAX_
-- ATTEMPTS in auth.module.ts) — this isn't a credential-guessing surface
-- in the same sense (a wrong guess reveals nothing but "valid: false"),
-- but the token space still shouldn't be brute-forceable at an unbounded
-- rate. documents.service.ts's verify() enforces the actual threshold.
-- ============================================================================

create table document_verify_attempts (
  id             uuid primary key default gen_random_uuid(),
  token_hash     text not null,
  attempted_at   timestamptz not null default now()
);
create index idx_document_verify_attempts_hash_time on document_verify_attempts (token_hash, attempted_at);

grant select, insert on document_verify_attempts to pbsms_app;
