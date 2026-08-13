import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL, TenantDatabaseService } from './tenant-database.service';

/** PLATFORM_POOL connects as `pbsms_platform` (0021_tenant_lifecycle.sql),
 * the mirror of pbsms_app for the three platform tables TEN-005 exempts
 * from tenant scoping (tenants, plans, platform_audit_logs). No
 * request-scoped tenant-variable dance needed here — those tables aren't
 * tenant-scoped at all, so a plain shared pool is correct, unlike PG_POOL's
 * request-scoped wrapper (TenantDatabaseService). Only
 * modules/tenants/tenants.service.ts should inject this. */
export const PLATFORM_POOL = Symbol('PLATFORM_POOL');

/**
 * database.module.ts
 *
 * @Global so every feature module (students, schools, ...) can inject
 * TenantDatabaseService without each one re-importing this module.
 *
 * The pool itself is a normal, shared, non-tenant-aware connection pool —
 * tenant scoping happens per checked-out client in TenantDatabaseService,
 * not here. Do not add `SET app.current_tenant` anywhere in this file; it
 * would be meaningless at the pool level and would suggest a false sense
 * of tenant safety at the wrong layer.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () =>
        new Pool({
          connectionString: process.env.DATABASE_URL,
          max: Number(process.env.PG_POOL_MAX ?? 10),
          // IMPORTANT (NFR-SEC-010): DATABASE_URL must point at the
          // restricted pbsms_app role created in
          // infra/migrations/0001_init_tenancy.sql, never at the
          // migration/owner role or a superuser. Table owners and
          // superusers both bypass RLS regardless of BYPASSRLS — see that
          // migration's "RESTRICTED APPLICATION ROLE" section for how this
          // was actually caught (running the e2e isolation suite against
          // the owner role passed with zero isolation in effect).
        }),
    },
    {
      provide: PLATFORM_POOL,
      useFactory: () =>
        new Pool({
          connectionString: process.env.PLATFORM_DATABASE_URL,
          max: Number(process.env.PG_POOL_MAX ?? 10),
          // IMPORTANT: must point at pbsms_platform, never pbsms_app or
          // the migration/owner role — pbsms_app has zero grants on the
          // platform tables (TEN-005) and would fail every query; the
          // owner role would work but would defeat the point of having a
          // narrowly-scoped platform role at all.
        }),
    },
    TenantDatabaseService,
  ],
  // PG_POOL is exported too, not just TenantDatabaseService: auth.module.ts
  // injects it directly (the one legitimate place that queries outside
  // TenantDatabaseService — see that file's header). @Global() alone does
  // not make un-exported providers resolvable outside this module.
  exports: [PG_POOL, PLATFORM_POOL, TenantDatabaseService],
})
export class DatabaseModule {}
