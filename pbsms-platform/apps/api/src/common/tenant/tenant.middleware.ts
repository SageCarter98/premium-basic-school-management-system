/**
 * tenant.middleware.ts
 *
 * Implements SRS v2.1 FR-API-030: "Every authenticated request resolves
 * exactly one tenant context from the caller's credentials before any
 * handler executes; there is no code path in which a handler can be
 * reached without a resolved tenant."
 *
 * This is deliberately global middleware (see app.module.ts), not something
 * individual controllers opt into — a controller that "forgets" to apply a
 * tenant guard is the exact failure mode this file exists to make
 * impossible to reach in the first place.
 */

import { createHash } from 'node:crypto';
import { Inject, Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import { TenantContextStore } from './tenant-context';
import { PlatformContextStore } from './platform-context';
import { PLATFORM_POOL } from '../database/database.module';
import { PG_POOL } from '../database/tenant-database.service';
import { LEADERSHIP } from '../auth/role-groups';

interface AccessTokenClaims {
  sub: string; // user id
  tenantId: string | null; // null only for platform-role tokens — see Chapter 3
  isPlatformUser: boolean;
  roleCodes?: string[]; // absent on MFA-challenge tokens (auth.module.ts) — never present without tenantId
  mfaSetupRequired?: boolean; // SEC-030 bootstrap token (auth.module.ts's login()) — see MFA_SETUP_PATHS below
  /** Phase A3 (TEN-021): present only on a short-lived impersonation
   * token minted from an active impersonation_grants row
   * (impersonation.service.ts's mintToken()). tenantId/roleCodes on such
   * a token are the IMPERSONATED tenant/representative admin-view role,
   * not the platform actor's own — see the branch below. */
  impersonationGrantId?: string;
  iat?: number; // set automatically by jsonwebtoken (seconds since epoch) — used by the revocation check below
}

// '/v1/documents/verify' (FR-DOC-020): a third party verifies a document
// "without contacting the school" — i.e. with no login and no tenant
// context, same reasoning as '/v1/auth/login' itself. The handler
// (documents.controller.ts) resolves the token via a SECURITY DEFINER DB
// function (verify_document(), 0007_promotion_documents.sql), not via
// TenantDatabaseService, since there is no tenant to scope by here.
// '/v1/guardian-access-requests/submit': a guardian who was never
// proactively contacted has no tenant context of their own either — same
// shape as documents/verify above, a different SECURITY DEFINER function
// (submit_guardian_access_request(), 0043_guardian_access_requests.sql).
// A DELIBERATELY DIFFERENT PATH from the plain '/v1/guardian-access-
// requests' collection (GET list / POST approve / POST reject, all
// ordinary authenticated ACADEMIC_ADMIN routes) — PUBLIC_PATHS matches by
// path only, not HTTP method, so reusing the same path here would have
// made the authenticated GET/list public too.
// '/v1/tenant-applications/submit': a prospective school applying has no
// tenant AND no platform context — same shape again, one more SECURITY
// DEFINER-adjacent path (0045_tenant_applications.sql). Deliberately NOT
// under '/v1/platform/...' — that whole prefix is PLATFORM_PATH_PREFIX
// below, reserved for authenticated platform actors; review (GET list /
// approve / reject) DOES live there.
// '/v1/auth/mfa/verify': same reasoning as '/v1/auth/login' — the caller
// has only a short-lived MFA-challenge token (no tenant claims at all, see
// auth.module.ts's login()), not a real bearer accessToken, at this step.
// Phase B (0025_auth_completeness.sql): refresh/logout/password-reset all
// authenticate via a body-supplied token of their own (the refresh token,
// or nothing at all for a reset request) rather than a Bearer accessToken
// — same "no real access token exists yet at this step" category.
const PUBLIC_PATHS = new Set([
  '/health',
  '/v1/auth/login',
  '/v1/auth/mfa/verify',
  '/v1/auth/refresh',
  '/v1/auth/logout',
  '/v1/auth/password-reset/request',
  '/v1/auth/password-reset/confirm',
  '/v1/documents/verify',
  '/v1/guardian-access-requests/submit',
  '/v1/tenant-applications/submit',
]);

// Phase A2 (Chapter 3.1): platform-role requests carry no tenant of their
// own (TEN-013) and are only ever meaningful against this dedicated route
// namespace — every other route in this API assumes a resolved TENANT
// context (RLS via TenantDatabaseService), which a platform actor
// structurally cannot have without impersonating one. Phase A3 (TEN-021)
// added exactly that: a minted impersonation token (see the
// claims.impersonationGrantId branch below) is the ONLY way a
// platform-originated request reaches a tenant-shaped route; a plain
// platform token never can. Gating by prefix here, rather than trusting
// each platform controller to reject a stray tenant caller itself, is the
// same "impossible to forget" shape as PUBLIC_PATHS/MFA_SETUP_PATHS below.
const PLATFORM_PATH_PREFIX = '/v1/platform/';

// Stage 6 (Parent View, spec §6.3): the ONE other route namespace besides
// PUBLIC_PATHS that never carries a Bearer JWT — a guardian has no
// `users`/`tenant_users` row (0019_guardians.sql), so this resolves
// TenantContextStore from a possession-based `?token=` query param
// instead, verified fresh on every single request (never cached/trusted
// from a prior check) via verify_guardian_access() — same "SECURITY
// DEFINER function, never a blanket grant" shape as verify_document(),
// and the same "live-validated every request" posture Phase A3's
// impersonation grants already established for a token that can be
// revoked mid-session. userId is set to the guardian's own id (not a real
// `users` row) — safe because ParentController deliberately carries no
// @Roles() decorators (RolesGuard is unrestricted-by-default) and no
// other route ever resolves a context this way, so nothing downstream
// ever treats this id as a real staff actor.
const PARENT_PATH_PREFIX = '/v1/parent/';

// SEC-030: a mandatory-MFA role (auth.module.ts's MFA_MANDATORY_ROLES) that
// hasn't enrolled yet gets a token with mfaSetupRequired: true instead of a
// full one — it still resolves a real tenant context below (enrollMfa()/
// enableMfa() need TenantContextStore's userId), but is refused on every
// path except these two, so it cannot be used as a substitute for actually
// completing enrollment. enableMfa() re-issues a full token on success.
const MFA_SETUP_PATHS = new Set(['/v1/auth/mfa/enroll', '/v1/auth/mfa/enable']);

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(PLATFORM_POOL) private readonly platformPool: Pool,
    @Inject(PG_POOL) private readonly appPool: Pool,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    // NOT req.path/req.url: Nest's forRoutes('*') mounts this middleware in
    // a way that makes Express rewrite req.url relative to the ('*') match,
    // so req.path is "/" for every single request regardless of the real
    // path — this was silently defeating the whitelist below entirely
    // (verified live: /health and /v1/auth/login both got rejected before
    // this fix, which is what caught it). req.originalUrl is untouched by
    // that rewrite.
    const path = req.originalUrl.split('?')[0];
    if (PUBLIC_PATHS.has(path)) {
      return next();
    }

    // Checked before the Bearer-token requirement below — a guardian
    // request never carries one at all. Deliberately never falls through
    // to the JWT branches further down: an ordinary staff Bearer token
    // sent to this prefix is simply ignored, since only the query-param
    // token is ever consulted here.
    if (path.startsWith(PARENT_PATH_PREFIX)) {
      const rawToken = req.query.token;
      if (typeof rawToken !== 'string' || rawToken.length === 0) {
        throw new UnauthorizedException('Missing parent access token');
      }
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const result = await this.appPool.query<{ guardian_id: string; tenant_id: string }>(
        `select * from verify_guardian_access($1)`,
        [tokenHash],
      );
      if (result.rowCount === 0) {
        throw new UnauthorizedException('This parent access link is invalid, expired, or has been revoked');
      }
      const { guardian_id: guardianId, tenant_id: tenantId } = result.rows[0];
      // userId is the system service account (worker.ts's SYSTEM_ACTOR_ID),
      // NOT guardianId — see tenant-context.ts's guardianId doc comment for
      // why: audit_log.actor_user_id FKs to users(id), which no guardian
      // row satisfies. ParentViewService reads guardianId, never userId.
      return TenantContextStore.run(
        { tenantId, isPlatformUser: false, userId: '00000000-0000-0000-0000-000000000001', guardianId, roles: [] },
        () => next(),
      );
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let claims: AccessTokenClaims;
    try {
      claims = this.jwtService.verify<AccessTokenClaims>(authHeader.slice('Bearer '.length));
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Instant access-token revocation — LEADERSHIP/platform roles only
    // (0038_revoked_sessions.sql's header explains the scoping choice: a
    // live DB check bounded to the tiers that already require MFA and get
    // the most sensitive access, mirroring the impersonation-grant live
    // check further below, rather than a global check on every request).
    // claims.iat (seconds since epoch) is compared against
    // revoked_sessions.revoked_at so a token issued AFTER a revocation
    // event — e.g. a fresh login right after logout — is still accepted;
    // this kills sessions that existed at revocation time, not the user.
    const isLeadershipOrPlatform =
      claims.isPlatformUser || (claims.roleCodes ?? []).some((r) => LEADERSHIP.includes(r));
    if (isLeadershipOrPlatform) {
      const revokedRows = await this.appPool.query<{ revoked_at: string }>(
        `select revoked_at from revoked_sessions where user_id = $1`,
        [claims.sub],
      );
      if (
        (revokedRows.rowCount ?? 0) > 0 &&
        claims.iat !== undefined &&
        new Date(revokedRows.rows[0].revoked_at).getTime() > claims.iat * 1000
      ) {
        throw new UnauthorizedException('This session has been revoked — please log in again');
      }
    }

    // SEC-030 MFA-setup gate: checked FIRST and unconditionally — before
    // the platform/tenant branch below — because a setup-scoped token can
    // belong to EITHER kind of actor (platform users are now
    // MFA-mandatory too, Phase A2) and must be refused everywhere except
    // these two paths regardless of which kind it is. A previous version
    // of this file checked this only after resolving the tenant branch,
    // which let an unenrolled platform user's setup token reach every
    // /v1/platform/* route unchecked — caught live, not by inspection,
    // the same way the req.path/req.originalUrl bug below was.
    if (claims.mfaSetupRequired) {
      if (!MFA_SETUP_PATHS.has(path)) {
        throw new UnauthorizedException(
          'MFA enrollment required before accessing other endpoints (SEC-030) — ' +
            'call /v1/auth/mfa/enroll then /v1/auth/mfa/enable',
        );
      }
      // enrollMfa()/enableMfa() (auth.module.ts) only need userId, which
      // PlatformContextStore provides for either actor kind — avoids
      // forcing TenantContextStore's non-nullable tenantId to accept a
      // platform user's genuinely-null tenant (TEN-013).
      return PlatformContextStore.run({ userId: claims.sub, roleCodes: claims.roleCodes ?? [] }, () => next());
    }

    // Phase A3 (TEN-021): a genuine impersonation token. Checked BEFORE
    // the plain isPlatformUser branch below — an impersonation token also
    // carries isPlatformUser: true (for audit-trail clarity elsewhere),
    // but must route into TenantContextStore against the IMPERSONATED
    // tenant, not PlatformContextStore, and is refused on /v1/platform/*
    // itself (grant management always happens via the platform actor's
    // own token, never the impersonation token it produces).
    if (claims.impersonationGrantId) {
      if (path.startsWith(PLATFORM_PATH_PREFIX)) {
        throw new UnauthorizedException('An impersonation token cannot manage impersonation grants itself');
      }
      // Live-validated on EVERY request, not just at mint time — a
      // JWT-only expiry check would miss a grant revoked mid-session.
      // impersonation_grants is a platform table (0023) with no RLS, so
      // this is a plain SELECT, not a SECURITY DEFINER bypass like
      // is_tenant_member() — see that migration's header for why the two
      // situations differ.
      const grantRows = await this.platformPool.query(
        `select 1 from impersonation_grants
         where id = $1 and granted_to = $2 and revoked_at is null and expires_at > now()
         limit 1`,
        [claims.impersonationGrantId, claims.sub],
      );
      if (grantRows.rowCount === 0) {
        throw new UnauthorizedException('This impersonation grant has expired or been revoked');
      }
      return TenantContextStore.run(
        {
          tenantId: claims.tenantId!,
          isPlatformUser: true,
          userId: claims.sub,
          roles: claims.roleCodes ?? [],
          impersonationGrantId: claims.impersonationGrantId,
        },
        () => next(),
      );
    }

    // Platform-role requests (SRS Chapter 3.1, Phase A2): resolve
    // PlatformContextStore instead of TenantContextStore, and only for the
    // dedicated /v1/platform/* namespace. An ordinary platform token
    // (no impersonationGrantId — the branch above) cannot reach any
    // tenant-shaped route; only a minted impersonation token can.
    if (claims.isPlatformUser) {
      if (!path.startsWith(PLATFORM_PATH_PREFIX)) {
        throw new UnauthorizedException(
          'Platform-role tokens can only call /v1/platform/* routes — mint an impersonation ' +
            'token (TEN-021) via /v1/platform/impersonation/:grantId/token for tenant-shaped access.',
        );
      }
      return PlatformContextStore.run({ userId: claims.sub, roleCodes: claims.roleCodes ?? [] }, () => next());
    }

    if (path.startsWith(PLATFORM_PATH_PREFIX)) {
      throw new UnauthorizedException('Only a platform-role token may call /v1/platform/* routes');
    }

    if (!claims.tenantId) {
      throw new UnauthorizedException('Token carries no tenant — refusing to proceed (FR-API-030)');
    }

    TenantContextStore.run(
      { tenantId: claims.tenantId, isPlatformUser: false, userId: claims.sub, roles: claims.roleCodes ?? [] },
      () => next(),
    );
  }
}
