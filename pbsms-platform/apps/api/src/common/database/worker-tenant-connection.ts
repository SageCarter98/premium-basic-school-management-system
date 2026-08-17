/**
 * worker-tenant-connection.ts
 *
 * The worker process (src/worker.ts, Phase D / Chapter 35) executes job
 * handlers that need the exact same tenant-scoped query behaviour HTTP
 * requests get from TenantDatabaseService (TEN-004: SET app.current_tenant
 * before any query, one physical connection per unit of work) — but there
 * is no real HTTP request/response to tie release to, and Nest's
 * Scope.REQUEST DI container doesn't exist outside an actual incoming
 * request either (constructing one by hand via Nest's DI is exactly the
 * trap that caused Authorization Pass 1's real bug #1 — a Scope.REQUEST
 * provider silently unresolved when reached from a non-request context).
 *
 * Rather than reimplement TenantDatabaseService's connect/SET/query logic,
 * this subclasses it directly and passes a fake `{ res: undefined }`
 * Request — the base class's `res?.once('finish', ...)` auto-release
 * becomes a harmless no-op (optional chaining on undefined). This means
 * job handlers can `new DocumentsService(workerConn, pool)` /
 * `new CommunicationService(workerConn, staffService, guardiansService)`
 * exactly as Nest would construct them for an HTTP request — same classes,
 * same query() behaviour, zero duplicated business logic — and the only
 * new piece is release(), called explicitly once the worker's job loop
 * finishes a job. This is deterministic here in a way an HTTP response
 * isn't: a worker processes exactly one job at a time and fully awaits it
 * before dequeuing the next, so there's no ambiguity about when "done"
 * happens.
 *
 * The tenant to scope queries to still comes from TenantContextStore
 * (unchanged, inherited from the base class) — the worker wraps each job's
 * handler in TenantContextStore.run({ tenantId: job.tenantId, ... }, fn),
 * mirroring exactly what TenantMiddleware does per HTTP request.
 */

import { Pool } from 'pg';
import type { Request } from 'express';
import { TenantDatabaseService } from './tenant-database.service';

export class WorkerTenantConnection extends TenantDatabaseService {
  constructor(pool: Pool) {
    super(pool, { res: undefined } as unknown as Request);
  }

  release(): void {
    this.releaseClient();
  }
}
