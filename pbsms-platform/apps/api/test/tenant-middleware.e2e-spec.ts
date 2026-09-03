/**
 * tenant-middleware.e2e-spec.ts
 *
 * FR-API-030 — genuinely untested before this file. Every other e2e-spec
 * in this repo bypasses TenantMiddleware entirely, calling
 * TenantContextStore.run() directly with a hardcoded tenant/user id (see
 * e.g. health.e2e-spec.ts's asUser() helper) — none of them exercise the
 * middleware itself, which is the actual global enforcement point FR-API-030
 * describes ("no code path in which a handler can be reached without a
 * resolved tenant context, platform-role requests included").
 *
 * Deliberately DB-free rather than following the WorkerTenantConnection
 * pattern: TenantMiddleware only touches Postgres for two specific checks
 * (revoked-session lookup for leadership/platform actors, live impersonation-
 * grant validation) — both mocked here via jest.fn() Pool stand-ins, so this
 * suite needs no running database and runs the same way lint/typecheck does.
 * The one branch this file does NOT cover is PARENT_PATH_PREFIX (guardian
 * query-token access) — that path calls verify_guardian_access(), a real
 * SECURITY DEFINER DB function with no meaningful mock; it's exercised
 * indirectly by the parent-view e2e suite's actual DB-backed guardian flows
 * instead.
 *
 * Not a protected-zone file itself (this is a new test file under
 * apps/api/test/, not a file under apps/api/src/common/tenant/), so this is
 * ordinary Stage-3 test-only work, not a protected-zone drafting PR.
 */

import { JwtService } from '@nestjs/jwt';
import type { Pool } from 'pg';
import type { Request, Response } from 'express';
import { TenantMiddleware } from '../src/common/tenant/tenant.middleware';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { PlatformContextStore } from '../src/common/tenant/platform-context';

const JWT_SECRET = process.env.JWT_SECRET ?? 'CHANGE_ME_IN_ENV_NEVER_COMMIT_A_REAL_SECRET';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TEACHER_ID = '99999999-0000-0000-0000-000000000003';
const PLATFORM_USER_ID = '99999999-0000-0000-0000-000000000099';

interface Claims {
  sub: string;
  tenantId: string | null;
  isPlatformUser: boolean;
  roleCodes?: string[];
  mfaSetupRequired?: boolean;
  impersonationGrantId?: string;
}

function fakeReq(path: string, token?: string): Request {
  return {
    originalUrl: path,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    query: {},
  } as unknown as Request;
}

describe('TenantMiddleware (FR-API-030)', () => {
  let jwtService: JwtService;
  let platformPool: { query: jest.Mock };
  let appPool: { query: jest.Mock };
  let middleware: TenantMiddleware;

  beforeEach(() => {
    jwtService = new JwtService({ secret: JWT_SECRET });
    platformPool = { query: jest.fn() };
    appPool = { query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }) };
    middleware = new TenantMiddleware(jwtService, platformPool as unknown as Pool, appPool as unknown as Pool);
  });

  function run(req: Request): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const next = (err?: unknown) => (err ? reject(err) : resolve());
      middleware.use(req, {} as Response, next as never).catch(reject);
    });
  }

  function sign(claims: Claims): string {
    return jwtService.sign(claims);
  }

  describe('PUBLIC_PATHS', () => {
    it('lets /health through with no token at all and resolves no context', async () => {
      await expect(run(fakeReq('/health'))).resolves.toBeUndefined();
    });

    it('lets /v1/auth/login through with no token, ignoring any query string', async () => {
      await expect(run(fakeReq('/v1/auth/login?x=1'))).resolves.toBeUndefined();
    });
  });

  describe('missing or invalid bearer token', () => {
    it('rejects a protected path with no Authorization header', async () => {
      await expect(run(fakeReq('/v1/students'))).rejects.toThrow(/Missing bearer token/);
    });

    it('rejects a non-Bearer Authorization header', async () => {
      const req = { originalUrl: '/v1/students', headers: { authorization: 'Basic abc' }, query: {} } as unknown as Request;
      await expect(run(req)).rejects.toThrow(/Missing bearer token/);
    });

    it('rejects a garbage token', async () => {
      await expect(run(fakeReq('/v1/students', 'not-a-real-jwt'))).rejects.toThrow(/Invalid or expired token/);
    });
  });

  describe('ordinary tenant token', () => {
    it('resolves TenantContextStore with the token\'s claims and reaches the handler', async () => {
      let captured: ReturnType<typeof TenantContextStore.current> | undefined;
      const req = fakeReq('/v1/students', sign({ sub: TEACHER_ID, tenantId: TENANT_A, isPlatformUser: false, roleCodes: ['teacher'] }));
      const next = () => {
        captured = TenantContextStore.current();
      };
      await middleware.use(req, {} as Response, next as never);
      expect(captured).toEqual({ tenantId: TENANT_A, isPlatformUser: false, userId: TEACHER_ID, roles: ['teacher'] });
      // A non-leadership role never triggers the revoked-session DB check (see tenant.middleware.ts).
      expect(appPool.query).not.toHaveBeenCalled();
    });

    it('refuses a token that carries no tenantId at all (FR-API-030\'s own stated invariant)', async () => {
      const req = fakeReq('/v1/students', sign({ sub: TEACHER_ID, tenantId: null, isPlatformUser: false, roleCodes: ['teacher'] }));
      await expect(run(req)).rejects.toThrow(/Token carries no tenant.*FR-API-030/);
    });

    it('refuses an ordinary tenant token on a /v1/platform/* route', async () => {
      const req = fakeReq('/v1/platform/tenants', sign({ sub: TEACHER_ID, tenantId: TENANT_A, isPlatformUser: false, roleCodes: ['teacher'] }));
      await expect(run(req)).rejects.toThrow(/Only a platform-role token may call/);
    });
  });

  describe('platform-role token', () => {
    it('resolves PlatformContextStore on a /v1/platform/* route and reaches the handler', async () => {
      let captured: ReturnType<typeof PlatformContextStore.current> | undefined;
      const req = fakeReq('/v1/platform/tenants', sign({ sub: PLATFORM_USER_ID, tenantId: null, isPlatformUser: true, roleCodes: ['platform_admin'] }));
      const next = () => {
        captured = PlatformContextStore.current();
      };
      await middleware.use(req, {} as Response, next as never);
      expect(captured).toEqual({ userId: PLATFORM_USER_ID, roleCodes: ['platform_admin'] });
      // isPlatformUser is one of the two isLeadershipOrPlatform triggers.
      expect(appPool.query).toHaveBeenCalledWith(expect.stringContaining('revoked_sessions'), [PLATFORM_USER_ID]);
    });

    it('refuses a plain platform token (no impersonation grant) on any non-platform route', async () => {
      const req = fakeReq('/v1/students', sign({ sub: PLATFORM_USER_ID, tenantId: null, isPlatformUser: true, roleCodes: ['platform_admin'] }));
      await expect(run(req)).rejects.toThrow(/Platform-role tokens can only call \/v1\/platform/);
    });

    it('is refused instantly when its session has been revoked after the token was issued', async () => {
      appPool.query.mockResolvedValue({ rowCount: 1, rows: [{ revoked_at: new Date(Date.now() + 60_000).toISOString() }] });
      const req = fakeReq('/v1/platform/tenants', sign({ sub: PLATFORM_USER_ID, tenantId: null, isPlatformUser: true, roleCodes: ['platform_admin'] }));
      await expect(run(req)).rejects.toThrow(/session has been revoked/);
    });
  });

  describe('SEC-030 MFA-setup tokens', () => {
    it('refuses every path except the two enrollment endpoints', async () => {
      const req = fakeReq('/v1/students', sign({ sub: TEACHER_ID, tenantId: TENANT_A, isPlatformUser: false, roleCodes: ['teacher'], mfaSetupRequired: true }));
      await expect(run(req)).rejects.toThrow(/MFA enrollment required.*SEC-030/);
    });

    it('lets /v1/auth/mfa/enroll through, resolving PlatformContextStore for userId only', async () => {
      let captured: ReturnType<typeof PlatformContextStore.current> | undefined;
      const req = fakeReq('/v1/auth/mfa/enroll', sign({ sub: TEACHER_ID, tenantId: TENANT_A, isPlatformUser: false, roleCodes: ['teacher'], mfaSetupRequired: true }));
      const next = () => {
        captured = PlatformContextStore.current();
      };
      await middleware.use(req, {} as Response, next as never);
      expect(captured).toEqual({ userId: TEACHER_ID, roleCodes: ['teacher'] });
    });
  });
});
