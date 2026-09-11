/**
 * rate-limit.guard.ts
 *
 * FR-API-040 ("Rate limits are enforced per tenant and per user
 * (NFR-PERF-010); limit responses use standard 429 semantics with a
 * Retry-After header"), SRS Chapter 32.1.
 *
 * ADOPTED AS A ONE-OFF, EXPLICIT STAGE-4 EXCEPTION — see CLAUDE.md's
 * "Internal Engineering Agent" section, "What's actually authorized right
 * now", 2026-09-11 entry. General implementation work (Stage 4) remains
 * gated on a human defect-escape baseline that does not exist yet; this
 * file was authorized as a scoped exception for this one requirement, by
 * explicit Engineering Lead decision, not as a reopening of Stage 4.
 *
 * Deliberately NOT the Postgres-table-counter pattern
 * auth.module.ts (login lockout) and documents.service.ts (FR-DOC-020
 * verify-token guessing) both use — this guard runs on every authenticated
 * request across the whole API, and a DB round-trip on every single
 * request would work against the NFR it exists to serve. Instead: an
 * in-process, fixed-window counter, registered globally via APP_GUARD the
 * same way RolesGuard is (see authorization.module.ts) so it's
 * impossible to forget on a new controller.
 *
 * Real, stated limitation, not hidden: this is correct for exactly one
 * running process. The SRS's own architecture table names Redis for this
 * NFR (Chapter 6.1 -- "Cache & queues: Redis -- Session cache, rate
 * limiting (NFR-PERF-010)"), but nothing in this codebase uses Redis
 * today despite REDIS_URL sitting in .env since the scaffold's first
 * commit -- standing up a new external dependency for a single-instance
 * local scaffold was judged disproportionate for this pass. Swapping the
 * in-process Map below for a Redis-backed store is the correct fix the
 * moment this API runs as more than one instance; until then, every
 * instance would enforce its own independent limit, which under-enforces
 * (N instances effectively multiply the real ceiling by N) rather than
 * over-enforces -- the safer direction for a limitation to fail in.
 *
 * The other half of NFR-PERF-010 ("a background-job fair-share") is a
 * different subsystem (the background_jobs queue, Chapter 35) and is
 * explicitly NOT covered here -- flagged as deferred, not silently
 * folded in or dropped.
 *
 * Thresholds (120 req/min per user, 600 req/min per tenant) are a
 * starting guess, same honesty as EC-503's 400-line diff ceiling ("a
 * guess per the spec's own Open Questions, to be re-set from
 * measurement") -- the SRS names no concrete number for this NFR.
 */

import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { TenantContextStore } from '../tenant/tenant-context';

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_PER_USER = 120;
export const RATE_LIMIT_PER_TENANT = 600;

interface WindowCounter {
  count: number;
  resetAt: number;
}

interface LimitCheck {
  allowed: boolean;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  // Instance (not module-level) state: one guard instance lives for the
  // whole process (Nest's default provider scope), so this is
  // functionally identical to a module-level Map, but lets tests build a
  // fresh guard with clean state instead of needing an explicit reset.
  private readonly userCounters = new Map<string, WindowCounter>();
  private readonly tenantCounters = new Map<string, WindowCounter>();

  canActivate(context: ExecutionContext): boolean {
    if (process.env.RATE_LIMIT_ENABLED === 'false') return true;

    let ctx;
    try {
      ctx = TenantContextStore.current();
    } catch {
      // No tenant context resolved for this request -- a public path
      // (login, health, document verification) that never reaches
      // TenantMiddleware's context-setting step. Those already have
      // their own dedicated, purpose-built limiters (see this file's
      // header) and platform-role requests are a separate, tenant-less
      // concern FR-API-040's "per tenant" framing doesn't cover -- both
      // are out of scope for this guard, not silently missed.
      return true;
    }

    const now = Date.now();
    const userResult = this.check(this.userCounters, `${ctx.tenantId}:${ctx.userId}`, RATE_LIMIT_PER_USER, now);
    const tenantResult = this.check(this.tenantCounters, ctx.tenantId, RATE_LIMIT_PER_TENANT, now);
    const exceeded = !userResult.allowed ? userResult : !tenantResult.allowed ? tenantResult : null;

    if (exceeded) {
      const res = context.switchToHttp().getResponse<Response>();
      res.setHeader('Retry-After', String(exceeded.retryAfterSeconds));
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private check(counters: Map<string, WindowCounter>, key: string, limit: number, now: number): LimitCheck {
    let counter = counters.get(key);
    if (!counter || counter.resetAt <= now) {
      counter = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      counters.set(key, counter);
    }
    counter.count += 1;
    if (counter.count > limit) {
      return { allowed: false, retryAfterSeconds: Math.ceil((counter.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
