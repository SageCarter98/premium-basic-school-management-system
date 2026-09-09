/**
 * migration-data-integrity.spec.ts
 *
 * NFR-QA-030 (SRS v2.1): "Migration tests compare counts, identifiers,
 * relationships, scores, results, invoice balances, payments and documents
 * before and after any migration."
 *
 * Deliberately NOT an *.e2e-spec.ts file, and not picked up by
 * test/jest-e2e.json (testRegex ".e2e-spec.ts$") or the unit config
 * (jest.config.js, rootDir "src") -- run instead via its own
 * test:migration-integrity script / test/jest-migration-integrity.json.
 * Reason: unlike every other e2e spec, this one starts by DROPPING AND
 * RECREATING the entire `public` schema against MIGRATE_DATABASE_URL, then
 * replays every migration from scratch -- destructive to whatever the
 * other ~25 e2e specs in test/ currently assume is already seeded there.
 * Interleaving it into the shared test:e2e run would risk wiping fixtures
 * another spec file created moments before. It runs in its own CI job
 * instead (see .github/workflows/ci.yml's migration-data-integrity job),
 * with its own disposable Postgres service, and its own end state (every
 * migration applied + seed_demo.sql) happens to be byte-identical to what
 * `npm run migrate && npm run seed` would produce -- so it is also safe to
 * run against a local dev Postgres, on the same understanding that
 * `migrate`/`seed` already carry: MIGRATE_DATABASE_URL is a disposable
 * dev/CI credential, never point it at anything real.
 *
 * What this does NOT attempt: replaying all 49 migrations individually as
 * 49 separate before/after boundaries. That would be a much larger,
 * separate undertaking (each boundary needs its own representative seed
 * state, and most of the early migrations only ever ran once, against an
 * empty database, in this repo's real history -- there is no historical
 * "before" data they could plausibly have corrupted that wasn't already
 * covered by ordinary review at the time). What NFR-QA-030 actually
 * protects against going forward is the NEXT migration silently breaking
 * existing tenant data -- so this test always targets the boundary between
 * every migration but the most recently added one, and the one just added
 * (see tools/migration-integrity.ts's splitBeforeAfter) -- it re-points
 * itself automatically as new migrations land, the same way EC-501/EC-502
 * apply to whatever changed in a PR rather than to a fixed file list.
 */
import { Client } from 'pg';
import { join } from 'path';
import { readFileSync } from 'fs';
import {
  readMigrationFiles,
  splitBeforeAfter,
  tablesCreatedBy,
  compareRowCounts,
  compareTableRows,
} from '../tools/migration-integrity';

const MIGRATIONS_DIR = join(__dirname, '../../../infra/migrations');
const SEED_PATH = join(__dirname, '../../../infra/seed/seed_demo.sql');

// The NFR-QA-030 text names these categories by name; each maps onto one or
// more real tables here. Content (not just row count) is compared for all
// of them, so a migration that preserves row counts but corrupts a value
// (e.g. rewrites a score, drops an invoice's tenant_id) still fails.
const CURATED_TABLES = [
  'students', // identifiers
  'enrolments', // relationships
  'teacher_assignments', // relationships
  'guardians', // identifiers
  'student_guardians', // relationships
  'scores', // scores
  'student_results', // results
  'student_result_items', // results
  'invoices', // invoice balances
  'invoice_items', // invoice balances
  'payments', // payments
  'payment_allocations', // payments
  'generated_documents', // documents
];

async function tableRowCounts(client: Client): Promise<Record<string, number>> {
  const { rows: tables } = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const { rows } = await client.query(`select count(*)::int as n from "${table_name}"`);
    counts[table_name] = rows[0].n;
  }
  return counts;
}

async function snapshotCuratedTables(client: Client): Promise<Record<string, unknown[]>> {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of CURATED_TABLES) {
    const { rows } = await client.query(`select * from "${table}"`);
    snapshot[table] = rows;
  }
  return snapshot;
}

interface Fixture {
  lastMigrationName: string;
  allowedNewTables: string[];
  beforeCounts: Record<string, number>;
  afterCounts: Record<string, number>;
  beforeCurated: Record<string, unknown[]>;
  afterCurated: Record<string, unknown[]>;
}

describe('NFR-QA-030 migration before/after data integrity', () => {
  jest.setTimeout(180_000);
  let client: Client;
  let fixture: Fixture;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.MIGRATE_DATABASE_URL });
    await client.connect();

    // Full reset, same procedure this repo already documents for local dev
    // (see the "Postgres is not a service here" / schema-reset notes) --
    // makes this test self-contained and re-runnable against either a
    // fresh CI Postgres or an existing local dev one.
    await client.query('drop schema public cascade');
    await client.query('create schema public');
    // A schema recreated this way does not reliably keep pbsms_app's (and
    // later, pbsms_platform's/pbsms_worker's) USAGE grant on it -- observed
    // directly in this environment. Migrations only grant explicit
    // table-level DML, never schema USAGE, so this has to be restored by
    // hand or every later query from those roles fails with "relation does
    // not exist" (not a permission error) rather than a clean denial.
    await client.query('grant usage on schema public to public');

    const files = readMigrationFiles(MIGRATIONS_DIR);
    const { before, after } = splitBeforeAfter(files);

    for (const migration of before) {
      await client.query(migration.sql);
    }

    await client.query(readFileSync(SEED_PATH, 'utf8'));

    const beforeCounts = await tableRowCounts(client);
    const beforeCurated = await snapshotCuratedTables(client);

    await client.query(after.sql);

    const afterCounts = await tableRowCounts(client);
    const afterCurated = await snapshotCuratedTables(client);

    fixture = {
      lastMigrationName: after.name,
      allowedNewTables: tablesCreatedBy(after.sql),
      beforeCounts,
      afterCounts,
      beforeCurated,
      afterCurated,
    };
  });

  afterAll(async () => {
    await client.end();
  });

  it('applied the migration under test against a real, non-empty database', () => {
    expect(fixture.lastMigrationName.length).toBeGreaterThan(0);
    // Sanity check that seeding actually happened before the boundary --
    // an empty "before" state would make every comparison below vacuous.
    expect(fixture.beforeCounts.students).toBeGreaterThan(0);
    expect(fixture.beforeCounts.tenants).toBeGreaterThan(0);
  });

  it('preserves row counts for every table the migration was not supposed to create', () => {
    const mismatches = compareRowCounts(fixture.beforeCounts, fixture.afterCounts, fixture.allowedNewTables);
    expect(mismatches).toEqual([]);
  });

  it('preserves the exact content of identifiers, relationships, scores, results, invoice balances, payments and documents', () => {
    for (const table of CURATED_TABLES) {
      const diff = compareTableRows(fixture.beforeCurated[table], fixture.afterCurated[table]);
      expect({ table, diff }).toEqual({ table, diff: null });
    }
  });

  it('actually created any table the migration under test claims to create', () => {
    for (const table of fixture.allowedNewTables) {
      expect(fixture.afterCounts).toHaveProperty(table);
    }
  });
});
