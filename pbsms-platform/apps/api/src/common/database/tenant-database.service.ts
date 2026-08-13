/**
 * tenant-database.service.ts
 *
 * Implements SRS v2.1 TEN-004: "Every database connection used to serve a
 * tenant request MUST set the RLS session variable for that tenant before
 * any query executes, and connection pooling MUST reset or re-set this
 * variable between reuses so that a pooled connection can never leak one
 * tenant's session context into another tenant's request."
 *
 * Why request-scoped: `SET app.current_tenant` is scoped to a single
 * physical connection. If we used the pg Pool's default `pool.query(...)`,
 * two queries in the same request could silently run on two different
 * pooled connections — one with the tenant set, one without. So this
 * service checks a single client OUT of the pool for the lifetime of one
 * HTTP request (Nest's REQUEST scope gives us exactly that lifetime), sets
 * the tenant on it once, and every query in that request reuses it.
 *
 * How the client is released — and why this is NOT an onModuleDestroy
 * hook, despite that being the obvious first instinct for a Scope.REQUEST
 * provider: NestJS does not reliably invoke lifecycle hooks for
 * request-scoped providers deterministically per HTTP request — teardown
 * is tied to garbage collection of the per-request DI context, not to the
 * response actually completing. This was caught live, not by inspection:
 * with an onModuleDestroy-based release, the pool silently leaked one
 * connection per request (each connection sat perfectly idle at the
 * Postgres level, but node-postgres's Pool never saw it returned), and
 * after exactly PG_POOL_MAX requests every subsequent request — including
 * an unrelated login — hung forever waiting for a client that was never
 * coming back. Releasing explicitly on the Express response's 'finish'
 * (and 'close', for aborted requests) event instead ties cleanup to the
 * actual HTTP lifecycle, which is deterministic.
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { Pool, PoolClient } from 'pg';
import { TenantContextStore } from '../tenant/tenant-context';

export const PG_POOL = Symbol('PG_POOL');

@Injectable({ scope: Scope.REQUEST })
export class TenantDatabaseService {
  private client: PoolClient | null = null;
  private released = false;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  private async getClient(): Promise<PoolClient> {
    if (this.client) return this.client;

    const { tenantId } = TenantContextStore.current(); // throws if unresolved — see tenant-context.ts

    const client = await this.pool.connect();
    try {
      // Postgres's SET statement does not accept bind parameters (only
      // literals) — set_config() is the parameterizable equivalent.
      // is_local=false so it lasts for the whole connection checkout.
      await client.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
    } catch (err) {
      client.release();
      throw err;
    }
    this.client = client;

    // Deterministic, one-shot release regardless of how the response ends.
    // request.res is the underlying Express Response — available because
    // this service only ever runs inside an HTTP request (Scope.REQUEST).
    const res = this.request.res;
    res?.once('finish', () => this.releaseClient());
    res?.once('close', () => this.releaseClient());

    return client;
  }

  private releaseClient(): void {
    if (!this.client || this.released) return;
    this.released = true;
    const client = this.client;
    this.client = null;
    // RESET before returning to the pool (TEN-004: never leak tenant
    // context into the next reuse). Fire-and-forget is fine here — there
    // is nothing left in this request to await it, and a failed RESET
    // still releases the client rather than leaking it a second way.
    client
      .query('RESET app.current_tenant')
      .catch(() => undefined)
      .finally(() => client.release());
  }

  async query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
    const client = await this.getClient();
    const result = await client.query(text, params);
    return result.rows;
  }
}
