import { Body, Controller, Injectable, Module, Post, UnauthorizedException, ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/database/tenant-database.service';
import { Inject } from '@nestjs/common';
import { PlatformContextStore } from '../../common/tenant/platform-context';
import { generateTotpSecret, verifyTotp, otpauthUri } from '../../common/auth/totp';
import { LEADERSHIP } from '../../common/auth/role-groups';

/**
 * auth.module.ts
 *
 * Minimal login flow proving where a tenant_id enters the first place: at
 * authentication, once, from the tenant_users row — never accepted as a
 * client-supplied parameter anywhere else in the API. A request cannot say
 * "act on tenant X" by passing an X in the body; the only way tenant
 * context exists is via this token (see tenant.middleware.ts).
 *
 * SEC-020 (Argon2id hashing + rate-limited login + secure reset) and
 * SEC-030 (MFA) are now implemented for real. SEC-040 ("secure session
 * cookies, rotation, timeout and revocation") — this API has never used
 * cookies anywhere (Bearer JWT throughout, an API-first design consistent
 * with Chapter 34's multi-client/PWA framing); "rotation, timeout and
 * revocation" is implemented via refresh tokens instead, the Bearer-token
 * equivalent of what that SEC code is really asking for (0025_auth_
 * completeness.sql). Access tokens are now short-lived (1h, was a flat
 * 8h); a refresh token (30 days, single-use, rotated on every refresh with
 * reuse detection) renews them.
 *
 * logout()/refresh-reuse-detection/confirmPasswordReset() revoke the
 * REFRESH token chain AND now also record a revoked_sessions row
 * (0038_revoked_sessions.sql) — but tenant.middleware.ts only checks it
 * for LEADERSHIP/platform-role tokens, not every request (see that
 * migration's header for the scoping decision: bounded to the tiers that
 * already require MFA, mirroring impersonation's own live-grant-check
 * pattern, Phase A3, rather than a DB round-trip added to every single
 * API call). An ordinary staff/teacher access token still rides out its
 * own (now much shorter, 1h) natural expiry after "logout" — a
 * documented, intentional remaining gap for that slice of roles.
 *
 * role_codes now travels in the JWT (added Authorization Pass 1) —
 * RolesGuard (common/auth/roles.guard.ts) is what actually makes it mean
 * something; see tenant.middleware.ts for how it reaches
 * TenantContextStore per request.
 */

const RATE_LIMIT_WINDOW_MINUTES = 15;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const ACCESS_TOKEN_EXPIRES_IN = '1h';
const REFRESH_TOKEN_DAYS = 30;
const PASSWORD_RESET_TOKEN_MINUTES = 60;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
// Chapter 3/33.2 SEC-030: MFA mandatory for platform roles and school
// Proprietor/Administrator. Reuses role-groups.ts's LEADERSHIP tier rather
// than a second hardcoded list for the tenant-role half; platform users
// are checked separately below via row.is_platform_user (Chapter 3.1
// states MFA is mandatory for Platform Super Admin specifically, but this
// applies it to every platform role uniformly — the same "break-glass
// access, MFA mandatory" reasoning, and simpler than tracking which of
// the 4 platform roles individually needs it). Login now actually blocks
// general API access for these roles until they enroll — see the
// mfaSetupRequired branch in login() below — via a bootstrap path (a
// token scoped to exactly the two enrollment endpoints) rather than a
// bare refusal, so a role requiring MFA is never locked out with no way
// to set it up.
const MFA_MANDATORY_ROLES: string[] = LEADERSHIP;

@Injectable()
class AuthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly jwt: JwtService,
  ) {}

  /** SEC-040: issued alongside every FULL access token (never alongside
   * the narrow MFA-challenge/setup tokens, which are deliberately not
   * "real" sessions). Only the hash is stored — same "never store the
   * literal secret" principle as password_hash. */
  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    await this.pool.query(
      `insert into refresh_tokens (user_id, token_hash, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)`,
      [userId, hashToken(raw), REFRESH_TOKEN_DAYS],
    );
    return raw;
  }

  private async recentFailedAttempts(email: string): Promise<number> {
    const { rows } = await this.pool.query(
      `select count(*)::int as n from login_attempts
       where email = $1 and succeeded = false
         and attempted_at > now() - interval '${RATE_LIMIT_WINDOW_MINUTES} minutes'`,
      [email],
    );
    return rows[0].n;
  }

  private async recordAttempt(email: string, succeeded: boolean): Promise<void> {
    await this.pool.query(`insert into login_attempts (email, succeeded) values ($1, $2)`, [email, succeeded]);
  }

  /** See this file's header + 0038_revoked_sessions.sql's header — this is
   * the write side of the LEADERSHIP/platform-scoped instant-revocation
   * check tenant.middleware.ts performs on every request from those
   * tiers. Per-user, not per-token (access tokens are never persisted). */
  private async recordSessionRevocation(userId: string): Promise<void> {
    await this.pool.query(
      `insert into revoked_sessions (user_id, revoked_at) values ($1, now())
       on conflict (user_id) do update set revoked_at = now()`,
      [userId],
    );
  }

  async login(emailRaw: string, password: string) {
    const email = emailRaw.trim().toLowerCase();

    if ((await this.recentFailedAttempts(email)) >= RATE_LIMIT_MAX_ATTEMPTS) {
      throw new HttpException(
        `Too many failed login attempts. Try again after ${RATE_LIMIT_WINDOW_MINUTES} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Deliberately queries WITHOUT going through TenantDatabaseService: at
    // login time we do not yet know the tenant — that is what this query
    // is finding out. This is the one legitimate place in the codebase
    // that queries users/tenant_users directly against the pool. Every
    // other module goes through TenantDatabaseService.
    const client = await this.pool.connect();
    try {
      // login_lookup() is a SECURITY DEFINER function (see
      // 0001_init_tenancy.sql / 0016_authorization.sql) — a plain join
      // here would see zero rows for every user, always: this role has no
      // tenant context yet (that's what this query exists to find), and
      // tenant_users has RLS enabled, so an un-scoped session sees nothing
      // in it. Caught live, not by inspection.
      const { rows } = await client.query(`select * from login_lookup($1)`, [email]);

      if (rows.length === 0) {
        await this.recordAttempt(email, false);
        throw new UnauthorizedException('Invalid credentials');
      }

      const row = rows[0];
      const valid = await argon2.verify(row.password_hash, password);
      if (!valid) {
        await this.recordAttempt(email, false);
        throw new UnauthorizedException('Invalid credentials');
      }

      await this.recordAttempt(email, true);

      // A platform user's meaningful roleCodes are their PLATFORM roles
      // (platform_user_roles), not tenant role_codes — they hold no
      // tenant_users row at all (TEN-013), so row.role_codes is always
      // empty for them. tenant.middleware.ts reads this same field into
      // PlatformContextStore for platform requests.
      const roleCodes: string[] = row.is_platform_user ? (row.platform_role_codes ?? []) : (row.role_codes ?? []);

      if (row.mfa_enabled) {
        // Short-lived challenge token: deliberately carries no tenantId/
        // roleCodes/isPlatformUser, so tenant.middleware.ts's "Token
        // carries no tenant" check already refuses it on any real route —
        // this is not an extra check to remember, it falls out of the
        // existing FR-API-030 enforcement for free.
        const challengeToken = this.jwt.sign({ sub: row.user_id, mfaChallenge: true }, { expiresIn: '5m' });
        return { mfaRequired: true, challengeToken };
      }

      if (row.is_platform_user || roleCodes.some((r) => MFA_MANDATORY_ROLES.includes(r))) {
        // SEC-030 bootstrap path: password was correct, but this role
        // requires MFA and none is enrolled yet. Issue a token scoped to
        // exactly the two enrollment endpoints (see tenant.middleware.ts's
        // MFA_SETUP_PATHS) instead of a bare 403 with no way forward —
        // enrollMfa()/enableMfa() both resolve the caller via
        // TenantContextStore, which still needs a real tenantId/roleCodes
        // to populate, hence this carries the same claims a full token
        // would, just flagged as setup-only.
        const setupToken = this.jwt.sign({
          sub: row.user_id,
          tenantId: row.is_platform_user ? null : row.tenant_id,
          isPlatformUser: row.is_platform_user,
          roleCodes,
          mfaSetupRequired: true,
        });
        return { mfaSetupRequired: true, accessToken: setupToken };
      }

      const accessToken = this.jwt.sign({
        sub: row.user_id,
        tenantId: row.is_platform_user ? null : row.tenant_id,
        isPlatformUser: row.is_platform_user,
        roleCodes,
      });
      const refreshToken = await this.issueRefreshToken(row.user_id);

      return { accessToken, refreshToken };
    } finally {
      client.release();
    }
  }

  async verifyMfa(challengeToken: string, code: string) {
    let claims: { sub: string; mfaChallenge?: boolean };
    try {
      claims = this.jwt.verify(challengeToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }
    if (!claims.mfaChallenge) {
      throw new UnauthorizedException('Not an MFA challenge token');
    }

    const { rows } = await this.pool.query(`select * from auth_lookup_by_user_id($1)`, [claims.sub]);
    if (rows.length === 0 || !rows[0].mfa_secret) {
      throw new UnauthorizedException('MFA is not set up for this account');
    }
    const row = rows[0];

    if (!verifyTotp(row.mfa_secret, code)) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    const accessToken = this.jwt.sign({
      sub: claims.sub,
      tenantId: row.is_platform_user ? null : row.tenant_id,
      isPlatformUser: row.is_platform_user,
      roleCodes: row.is_platform_user ? (row.platform_role_codes ?? []) : (row.role_codes ?? []),
    });
    const refreshToken = await this.issueRefreshToken(claims.sub);
    return { accessToken, refreshToken };
  }

  /** Authenticated (post-login) step: generates and stores a pending
   * secret. Does NOT enable MFA yet — enableMfa() below does that, after
   * confirming the user's authenticator app actually produces matching
   * codes, so a typo'd/never-set-up authenticator can't lock the account
   * out. */
  async enrollMfa(userId: string, email: string) {
    const secret = generateTotpSecret();
    await this.pool.query(`update users set mfa_secret = $1, updated_at = now() where id = $2`, [secret, userId]);
    return { secret, otpauthUrl: otpauthUri(secret, email) };
  }

  async enableMfa(userId: string, code: string) {
    const { rows } = await this.pool.query(`select mfa_secret from users where id = $1`, [userId]);
    if (rows.length === 0 || !rows[0].mfa_secret) {
      throw new UnauthorizedException('Call /v1/auth/mfa/enroll first');
    }
    if (!verifyTotp(rows[0].mfa_secret, code)) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    await this.pool.query(`update users set mfa_enabled = true, updated_at = now() where id = $1`, [userId]);

    // The token that reached this handler may be a mfaSetupRequired-scoped
    // bootstrap token (see login() above), which cannot reach any other
    // endpoint per tenant.middleware.ts's MFA_SETUP_PATHS check. Re-issue a
    // full token now so completing enrollment doesn't also require a
    // second login.
    const { rows: info } = await this.pool.query(`select * from auth_lookup_by_user_id($1)`, [userId]);
    const accessToken = this.jwt.sign({
      sub: userId,
      tenantId: info[0].is_platform_user ? null : info[0].tenant_id,
      isPlatformUser: info[0].is_platform_user,
      roleCodes: info[0].is_platform_user ? (info[0].platform_role_codes ?? []) : (info[0].role_codes ?? []),
    });
    const refreshToken = await this.issueRefreshToken(userId);

    return { mfaEnabled: true, accessToken, refreshToken };
  }

  /** SEC-040 rotation with reuse detection. A presented token that's
   * already revoked (has a replaced_by_id, or was revoked by logout())
   * is a classic stolen-refresh-token signal — the standard response is
   * to kill the WHOLE chain, not just reject the one request, since an
   * attacker and the legitimate user racing to use the same stolen token
   * both look identical up to this point. */
  async refresh(rawToken: string) {
    const hash = hashToken(rawToken);
    const { rows } = await this.pool.query(
      `select * from refresh_tokens where token_hash = $1`,
      [hash],
    );
    if (rows.length === 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const token = rows[0];

    if (token.revoked_at) {
      await this.pool.query(
        `update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null`,
        [token.user_id],
      );
      await this.recordSessionRevocation(token.user_id);
      throw new UnauthorizedException('This refresh token was already used — all sessions for this account have been revoked');
    }
    if (new Date(token.expires_at).getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired — please log in again');
    }

    // Re-derive CURRENT roles rather than trusting whatever was true at
    // original login time — a role revoked since then must not survive
    // a refresh.
    const { rows: info } = await this.pool.query(`select * from auth_lookup_by_user_id($1)`, [token.user_id]);
    if (info.length === 0) {
      throw new UnauthorizedException('Account no longer exists');
    }
    const current = info[0];
    const roleCodes: string[] = current.is_platform_user
      ? (current.platform_role_codes ?? [])
      : (current.role_codes ?? []);

    const accessToken = this.jwt.sign({
      sub: token.user_id,
      tenantId: current.is_platform_user ? null : current.tenant_id,
      isPlatformUser: current.is_platform_user,
      roleCodes,
    });
    const newRawToken = randomBytes(32).toString('hex');
    const newHash = hashToken(newRawToken);
    const newRows = await this.pool.query(
      `insert into refresh_tokens (user_id, token_hash, expires_at) values ($1, $2, now() + ($3 || ' days')::interval) returning id`,
      [token.user_id, newHash, REFRESH_TOKEN_DAYS],
    );
    await this.pool.query(`update refresh_tokens set revoked_at = now(), replaced_by_id = $1 where id = $2`, [
      newRows.rows[0].id,
      token.id,
    ]);

    return { accessToken, refreshToken: newRawToken };
  }

  /** Revokes exactly one session (the refresh token presented) — see
   * this file's header for why this doesn't also invalidate any
   * already-issued access token. Idempotent and never reveals whether
   * the token existed, same "don't leak account state" principle as
   * requestPasswordReset() below. */
  async logout(rawToken: string): Promise<void> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `update refresh_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null returning user_id`,
      [hashToken(rawToken)],
    );
    if (rows.length > 0) {
      await this.recordSessionRevocation(rows[0].user_id);
    }
  }

  /** SEC-020's "secure reset." Never reveals whether the email is
   * registered (a generic response either way — the standard defence
   * against account enumeration via a password-reset endpoint). Real
   * email delivery of the reset link is out of scope for the same reason
   * dunning notifications are (0024_billing.sql's header) — no
   * WhatsApp/SMS/SMTP integration exists yet. */
  async requestPasswordReset(emailRaw: string): Promise<{ message: string }> {
    const email = emailRaw.trim().toLowerCase();
    const generic = {
      message: 'If that email is registered, password reset instructions would be sent to it.',
    };

    const { rows } = await this.pool.query(`select id from users where lower(email) = $1`, [email]);
    if (rows.length === 0) {
      return generic;
    }

    const rawToken = randomBytes(32).toString('hex');
    await this.pool.query(
      `insert into password_reset_tokens (user_id, token_hash, expires_at)
       values ($1, $2, now() + ($3 || ' minutes')::interval)`,
      [rows[0].id, hashToken(rawToken), PASSWORD_RESET_TOKEN_MINUTES],
    );
    // Email delivery pending Appendix E — the token exists and is fully
    // valid, but nothing sends it anywhere yet. Not returned in the
    // response (would defeat the point of hashing it at rest).

    return generic;
  }

  /** Resetting a password also revokes every existing refresh token for
   * that account — the same "a credential compromise should kill
   * existing sessions" reasoning enableMfa()/dunning's status changes
   * apply elsewhere, not merely a side effect. */
  async confirmPasswordReset(rawToken: string, newPassword: string): Promise<void> {
    const hash = hashToken(rawToken);
    const { rows } = await this.pool.query(
      `select * from password_reset_tokens where token_hash = $1 and used_at is null and expires_at > now()`,
      [hash],
    );
    if (rows.length === 0) {
      throw new ConflictException('Invalid or expired reset token');
    }
    const token = rows[0];

    const passwordHash = await argon2.hash(newPassword);
    await this.pool.query(`update users set password_hash = $1, updated_at = now() where id = $2`, [
      passwordHash,
      token.user_id,
    ]);
    await this.pool.query(`update password_reset_tokens set used_at = now() where id = $1`, [token.id]);
    await this.pool.query(
      `update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null`,
      [token.user_id],
    );
    await this.recordSessionRevocation(token.user_id);
  }
}

@Controller('v1/auth')
class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body.email, body.password);
  }

  @Post('mfa/verify')
  verifyMfa(@Body() body: { challengeToken: string; code: string }) {
    return this.auth.verifyMfa(body.challengeToken, body.code);
  }

  // Public (see tenant.middleware.ts's PUBLIC_PATHS) — authenticates via
  // the body-supplied refresh token itself, same category as login().
  @Post('refresh')
  refresh(@Body() body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  async logout(@Body() body: { refreshToken: string }) {
    await this.auth.logout(body.refreshToken);
    return { loggedOut: true };
  }

  @Post('password-reset/request')
  requestPasswordReset(@Body() body: { email: string }) {
    return this.auth.requestPasswordReset(body.email);
  }

  @Post('password-reset/confirm')
  async confirmPasswordReset(@Body() body: { token: string; newPassword: string }) {
    await this.auth.confirmPasswordReset(body.token, body.newPassword);
    return { passwordReset: true };
  }

  @Post('mfa/enroll')
  enrollMfa() {
    // PlatformContextStore, not TenantContextStore — tenant.middleware.ts
    // resolves an mfaSetupRequired token into PlatformContextStore
    // regardless of actor kind (see that file's header), since a platform
    // user's tenantId is genuinely null (TEN-013) and TenantContext's
    // tenantId is non-nullable.
    const { userId } = PlatformContextStore.current();
    // email isn't in PlatformContext either — the otpauth label falls
    // back to the user id, which is still unique and legible enough for
    // an authenticator app entry; only cosmetic.
    return this.auth.enrollMfa(userId, userId);
  }

  @Post('mfa/enable')
  enableMfa(@Body() body: { code: string }) {
    const { userId } = PlatformContextStore.current();
    return this.auth.enableMfa(userId, body.code);
  }
}

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'CHANGE_ME_IN_ENV_NEVER_COMMIT_A_REAL_SECRET',
      signOptions: { expiresIn: ACCESS_TOKEN_EXPIRES_IN },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
