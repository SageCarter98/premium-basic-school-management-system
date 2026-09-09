/**
 * migration-integrity.ts
 *
 * NFR-QA-030 (SRS v2.1): "Migration tests compare counts, identifiers,
 * relationships, scores, results, invoice balances, payments and documents
 * before and after any migration."
 *
 * Found via EC-107 as a real gap, not a missing citation: ci.yml's "Apply
 * migrations" step (see that step's own header comment) applies every
 * migration in order but takes no before-snapshot and makes no comparison
 * at all -- a migration that silently dropped rows, duplicated a row, or
 * broke a relationship would still pass CI. This file is the comparison
 * machinery that step's header names as deferred; test/migration-data-
 * integrity.spec.ts is the real before/after test built on it, and is what
 * now actually applies every migration (replacing that manual step).
 *
 * Pure, DB-free functions live here so they're unit-testable without a
 * real Postgres connection (see src/migration-integrity.spec.ts) -- same
 * split as check-migration-safety.ts / check-migration-safety.spec.ts.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export interface MigrationFile {
  name: string;
  path: string;
  sql: string;
}

/**
 * Reads every *.sql file in a migrations directory, sorted by filename --
 * the existing 4-digit zero-padded prefix (0001_..., 0002_..., ...) already
 * sorts correctly as a plain string sort, so no numeric parsing is needed.
 */
export function readMigrationFiles(migrationsDir: string): MigrationFile[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      path: join(migrationsDir, name),
      sql: readFileSync(join(migrationsDir, name), 'utf8'),
    }));
}

/**
 * Splits an ordered migration list into "every migration but the last"
 * (the state the NFR-QA-030 "before" snapshot is taken against) and "the
 * last" (the migration actually under test). Always the most-recently-added
 * migration -- deliberately not a hardcoded filename -- so this check stays
 * current as new migrations land without needing to be re-pointed by hand,
 * unlike ci.yml's old apply-list (which needed manual extension every time
 * and has gone stale twice in this repo's history).
 */
export function splitBeforeAfter(files: MigrationFile[]): { before: MigrationFile[]; after: MigrationFile } {
  if (files.length < 2) {
    throw new Error('Need at least two migrations to test a before/after boundary');
  }
  return { before: files.slice(0, -1), after: files[files.length - 1] };
}

const CREATE_TABLE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;

/**
 * Table names a migration's own text creates -- used to tell the row-count
 * comparison which new tables are EXPECTED to appear with no "before"
 * value, as opposed to an unexpected/unrelated table showing up (which
 * would mean something ran that the migration file doesn't account for).
 */
export function tablesCreatedBy(sql: string): string[] {
  return [...sql.matchAll(CREATE_TABLE_RE)].map((m) => m[1]);
}

export interface RowCountMismatch {
  table: string;
  before: number | null;
  after: number | null;
  reason: string;
}

/**
 * Compares per-table row counts before/after. A table present before must
 * have the identical count after, REGARDLESS of whether the migration under
 * test mentions it at all -- this is what catches a migration silently
 * dropping or duplicating rows in some other table it wasn't even supposed
 * to touch. A new table appearing after is only acceptable if the
 * migration's own text created it (allowedNewTables); anything else is
 * treated as a mismatch, same as a table disappearing.
 */
export function compareRowCounts(
  before: Record<string, number>,
  after: Record<string, number>,
  allowedNewTables: string[],
): RowCountMismatch[] {
  const mismatches: RowCountMismatch[] = [];
  const allowed = new Set(allowedNewTables);

  for (const table of Object.keys(before)) {
    if (!(table in after)) {
      mismatches.push({ table, before: before[table], after: null, reason: 'table dropped by migration' });
      continue;
    }
    if (after[table] !== before[table]) {
      mismatches.push({
        table,
        before: before[table],
        after: after[table],
        reason: `row count changed (${before[table]} -> ${after[table]})`,
      });
    }
  }

  for (const table of Object.keys(after)) {
    if (!(table in before) && !allowed.has(table)) {
      mismatches.push({
        table,
        before: null,
        after: after[table],
        reason: 'unexpected new table not created by the migration under test',
      });
    }
  }

  return mismatches;
}

/**
 * Order-independent content comparison for one table's rows: same rows (by
 * JSON content), regardless of row order (a migration is never expected to
 * preserve physical row order, only the rows themselves). Returns null if
 * identical, or a short description of the first difference found.
 */
export function compareTableRows(before: unknown[], after: unknown[]): string | null {
  if (before.length !== after.length) {
    return `row count differs: ${before.length} before, ${after.length} after`;
  }
  const sortedBefore = [...before].map((r) => JSON.stringify(r)).sort();
  const sortedAfter = [...after].map((r) => JSON.stringify(r)).sort();
  for (let i = 0; i < sortedBefore.length; i++) {
    if (sortedBefore[i] !== sortedAfter[i]) {
      return `row content differs after sorting (index ${i})`;
    }
  }
  return null;
}
