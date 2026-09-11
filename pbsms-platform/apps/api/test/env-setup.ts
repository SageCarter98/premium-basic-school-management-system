import { config } from 'dotenv';
import { resolve } from 'path';

// npm workspace scripts run with cwd = apps/api, but .env lives at the repo
// root (pbsms-platform/.env) — bare `dotenv/config` looks in cwd and would
// silently find nothing, leaving TEST_DATABASE_URL/DATABASE_URL undefined.
config({ path: resolve(__dirname, '../../../.env') });

// NFR-DEP-010 ("local, development, automated test, staging and production
// use separate databases"): TEST_DATABASE_URL/TEST_MIGRATE_DATABASE_URL/
// TEST_PLATFORM_DATABASE_URL point this whole suite at a genuinely separate
// pbsms_test database, not dev's pbsms — see .env.example for setup. Every
// e2e spec that opens a second, owner-role connection for FK-order-sensitive
// cleanup or cross-tenant verification (billing/documents/guardian-access/
// tenant-lifecycle/transport) reads the TEST_-prefixed variable first so
// that connection lands on the same database as everything else in the
// suite — a real bug this pass found and fixed: with only TEST_DATABASE_URL
// repointed, those cleanup connections silently kept hitting dev's pbsms,
// which no-ops on delete (nothing there to delete) and later throws a real
// FK violation once the untouched pbsms_test rows are enforced against.
