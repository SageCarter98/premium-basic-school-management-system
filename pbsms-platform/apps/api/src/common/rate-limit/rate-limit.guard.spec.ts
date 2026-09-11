/**
 * rate-limit.guard.spec.ts
 *
 * FR-API-040. Exercises RateLimitGuard.canActivate() directly against a
 * minimal mock ExecutionContext -- no HTTP server, no database. Genuinely
 * untested before this file (RateLimitGuard is new).
 */
import { HttpException, HttpStatus, ExecutionContext } from '@nestjs/common';
import { RateLimitGuard, RATE_LIMIT_PER_USER, RATE_LIMIT_PER_TENANT, RATE_LIMIT_WINDOW_MS } from './rate-limit.guard';
import { TenantContextStore } from '../tenant/tenant-context';

function mockContext(): { context: ExecutionContext; setHeader: jest.Mock } {
  const setHeader = jest.fn();
  const context = {
    switchToHttp: () => ({
      getResponse: () => ({ setHeader }),
      getRequest: () => ({}),
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { context, setHeader };
}

function asUser<T>(userId: string, tenantId: string, fn: () => T): T {
  return TenantContextStore.run({ tenantId, userId, roles: ['teacher'], isPlatformUser: false }, fn);
}

describe('RateLimitGuard (FR-API-040)', () => {
  const originalEnabled = process.env.RATE_LIMIT_ENABLED;

  afterEach(() => {
    process.env.RATE_LIMIT_ENABLED = originalEnabled;
  });

  it('allows requests with no resolved tenant context (public paths) unconditionally', () => {
    const guard = new RateLimitGuard();
    const { context } = mockContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows requests under the per-user limit', () => {
    const guard = new RateLimitGuard();
    const { context } = mockContext();
    asUser('u1', 't1', () => {
      for (let i = 0; i < RATE_LIMIT_PER_USER; i++) {
        expect(guard.canActivate(context)).toBe(true);
      }
    });
  });

  it('rejects the request that crosses the per-user limit with 429 + Retry-After', () => {
    const guard = new RateLimitGuard();
    const { context, setHeader } = mockContext();
    asUser('u2', 't1', () => {
      for (let i = 0; i < RATE_LIMIT_PER_USER; i++) {
        guard.canActivate(context);
      }
      let thrown: unknown;
      try {
        guard.canActivate(context);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      expect((thrown as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    });
  });

  it('does not let one user in a tenant starve a different user in the same tenant past the per-user ceiling', () => {
    const guard = new RateLimitGuard();
    const { context } = mockContext();
    asUser('u3', 't2', () => {
      for (let i = 0; i < RATE_LIMIT_PER_USER; i++) guard.canActivate(context);
    });
    // A different user, same tenant, has its own untouched per-user counter.
    asUser('u4', 't2', () => {
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  it('enforces the per-tenant ceiling even across many distinct users once the tenant total is exceeded', () => {
    const guard = new RateLimitGuard();
    const { context } = mockContext();
    for (let i = 0; i < RATE_LIMIT_PER_TENANT; i++) {
      asUser(`user-${i}`, 't3', () => guard.canActivate(context));
    }
    let thrown: unknown;
    try {
      asUser('one-more-user', 't3', () => guard.canActivate(context));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('resets the window after RATE_LIMIT_WINDOW_MS elapses', () => {
    jest.useFakeTimers();
    try {
      const guard = new RateLimitGuard();
      const { context } = mockContext();
      asUser('u5', 't4', () => {
        for (let i = 0; i < RATE_LIMIT_PER_USER; i++) guard.canActivate(context);
        expect(() => guard.canActivate(context)).toThrow(HttpException);

        jest.advanceTimersByTime(RATE_LIMIT_WINDOW_MS + 1);

        expect(guard.canActivate(context)).toBe(true);
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('RATE_LIMIT_ENABLED=false bypasses the guard entirely (operational kill switch)', () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
    const guard = new RateLimitGuard();
    const { context } = mockContext();
    asUser('u6', 't5', () => {
      for (let i = 0; i < RATE_LIMIT_PER_USER + 10; i++) {
        expect(guard.canActivate(context)).toBe(true);
      }
    });
  });
});
