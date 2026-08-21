-- ============================================================================
-- 0038_revoked_sessions.sql
--
-- Closes the "logout/password-reset revoke the refresh-token chain but the
-- already-issued access token rides out its own natural expiry" gap —
-- auth.module.ts's own header comment flags this as a real, documented
-- limitation. Scoped deliberately: LEADERSHIP-tier and platform-role
-- requests only get a live revocation check (tenant.middleware.ts), not
-- every request — the same bounded-blast-radius reasoning impersonation's
-- live grant-check (Phase A3) already applies, chosen over a global check
-- specifically to avoid adding a DB round-trip to the high-volume ordinary
-- staff/teacher request path for a risk that's concentrated in the
-- MFA-mandatory tiers already.
--
-- Not per-token (access tokens are never persisted anywhere — only their
-- claims exist, verified in-memory) — per-USER, same granularity
-- refresh-token reuse-detection already revokes at ("kill every session
-- for this account"). Not tenant-scoped, not RLS'd: same category as
-- refresh_tokens/login_attempts — a platform user's user_id has no
-- tenant_id at all (TEN-013), and this needs to be readable from
-- tenant.middleware.ts before any tenant context is resolved.
-- ============================================================================

create table revoked_sessions (
  user_id     uuid primary key references users(id),
  revoked_at  timestamptz not null
);

grant select, insert, update on revoked_sessions to pbsms_app;
