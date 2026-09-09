/**
 * migration-integrity.spec.ts
 *
 * Unit coverage for apps/api/tools/migration-integrity.ts's pure
 * comparison functions (NFR-QA-030). Exercises them directly with
 * synthetic before/after snapshots -- no Postgres involved here, that's
 * test/migration-data-integrity.spec.ts's job. The point of this file is
 * to prove the detection logic itself actually catches a real violation
 * rather than vacuously passing; a comparator that always returns "no
 * mismatch" would make the real DB-backed test worthless without this
 * being caught anywhere.
 */
import {
  compareRowCounts,
  compareTableRows,
  splitBeforeAfter,
  tablesCreatedBy,
  MigrationFile,
} from '../tools/migration-integrity';

describe('compareRowCounts (NFR-QA-030)', () => {
  it('reports no mismatches when every table is unchanged', () => {
    const before = { students: 5, invoices: 2 };
    const after = { students: 5, invoices: 2 };
    expect(compareRowCounts(before, after, [])).toEqual([]);
  });

  it('flags a table whose row count changed, even if the migration never mentions it', () => {
    const before = { students: 5, invoices: 2 };
    const after = { students: 4, invoices: 2 };
    const mismatches = compareRowCounts(before, after, []);
    expect(mismatches).toEqual([
      { table: 'students', before: 5, after: 4, reason: 'row count changed (5 -> 4)' },
    ]);
  });

  it('flags a table that disappeared entirely', () => {
    const before = { students: 5, invoices: 2 };
    const after = { students: 5 };
    const mismatches = compareRowCounts(before, after, []);
    expect(mismatches).toEqual([
      { table: 'invoices', before: 2, after: null, reason: 'table dropped by migration' },
    ]);
  });

  it('allows a new table only when the migration under test actually created it', () => {
    const before = { students: 5 };
    const after = { students: 5, assistant_interactions: 0 };
    expect(compareRowCounts(before, after, ['assistant_interactions'])).toEqual([]);
  });

  it('flags a new table the migration text never created', () => {
    const before = { students: 5 };
    const after = { students: 5, mystery_table: 3 };
    const mismatches = compareRowCounts(before, after, ['assistant_interactions']);
    expect(mismatches).toEqual([
      {
        table: 'mystery_table',
        before: null,
        after: 3,
        reason: 'unexpected new table not created by the migration under test',
      },
    ]);
  });
});

describe('compareTableRows (NFR-QA-030)', () => {
  it('returns null for identical rows regardless of order', () => {
    const before = [{ id: 'a', score: 10 }, { id: 'b', score: 20 }];
    const after = [{ id: 'b', score: 20 }, { id: 'a', score: 10 }];
    expect(compareTableRows(before, after)).toBeNull();
  });

  it('catches a changed field value on an otherwise-identical row', () => {
    const before = [{ id: 'a', score: 10 }];
    const after = [{ id: 'a', score: 99 }];
    expect(compareTableRows(before, after)).toMatch(/row content differs/);
  });

  it('catches a lost row', () => {
    const before = [{ id: 'a' }, { id: 'b' }];
    const after = [{ id: 'a' }];
    expect(compareTableRows(before, after)).toMatch(/row count differs: 2 before, 1 after/);
  });
});

describe('tablesCreatedBy', () => {
  it('extracts a plain create table statement', () => {
    expect(tablesCreatedBy('create table assistant_interactions (\n  id uuid\n);')).toEqual([
      'assistant_interactions',
    ]);
  });

  it('extracts a create table if not exists statement', () => {
    expect(tablesCreatedBy('create table if not exists widgets (id uuid);')).toEqual(['widgets']);
  });

  it('returns an empty list for a migration that only alters existing tables', () => {
    expect(tablesCreatedBy('alter table scores add column version integer not null default 1;')).toEqual([]);
  });
});

describe('splitBeforeAfter', () => {
  const file = (name: string): MigrationFile => ({ name, path: name, sql: '' });

  it('treats the last file as the migration under test', () => {
    const files = [file('0001_a.sql'), file('0002_b.sql'), file('0003_c.sql')];
    const { before, after } = splitBeforeAfter(files);
    expect(before.map((f) => f.name)).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(after.name).toBe('0003_c.sql');
  });

  it('throws with fewer than two migrations, since there is no boundary to test', () => {
    expect(() => splitBeforeAfter([file('0001_a.sql')])).toThrow();
  });
});
