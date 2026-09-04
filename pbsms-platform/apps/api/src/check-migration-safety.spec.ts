/**
 * check-migration-safety.spec.ts
 *
 * Unit coverage for apps/api/tools/check-migration-safety.ts's two pattern
 * checks: EC-502's original destructive-statement detector, and the
 * expand/contract (NFR-DEP-030) detector added alongside it. Exercises the
 * exported pure classification functions directly rather than shelling out
 * to git -- the tool's main() is a thin CLI wrapper around these; the git-
 * diff plumbing itself is unchanged by this addition and untested before
 * and after, same as it always was.
 *
 * Genuinely untested before this file (check-migration-safety.ts had no
 * test coverage at all, destructive-pattern detection included).
 */
import {
  findUnapprovedDestructiveStatements,
  findUnapprovedNonAdditiveStatements,
} from '../tools/check-migration-safety';

describe('findUnapprovedDestructiveStatements (EC-502)', () => {
  it('flags DROP TABLE with no exception comment', () => {
    expect(findUnapprovedDestructiveStatements('DROP TABLE foo;')).toBe(true);
  });

  it('flags an unqualified DELETE (no WHERE before the terminator)', () => {
    expect(findUnapprovedDestructiveStatements('DELETE FROM foo;')).toBe(true);
  });

  it('does not flag a qualified DELETE (has a WHERE clause)', () => {
    expect(findUnapprovedDestructiveStatements("DELETE FROM foo WHERE id = 'x';")).toBe(false);
  });

  it('does not flag DROP TABLE carrying the exception marker', () => {
    const content = '-- DESTRUCTIVE-MIGRATION-APPROVED: dropping an unused table\nDROP TABLE foo;';
    expect(findUnapprovedDestructiveStatements(content)).toBe(false);
  });

  it('does not flag an ordinary additive migration', () => {
    expect(findUnapprovedDestructiveStatements('ALTER TABLE foo ADD COLUMN bar text;')).toBe(false);
  });
});

describe('findUnapprovedNonAdditiveStatements (NFR-DEP-030)', () => {
  it('flags ALTER TABLE ... RENAME COLUMN with no exception comment', () => {
    expect(findUnapprovedNonAdditiveStatements('ALTER TABLE foo RENAME COLUMN bar TO baz;')).toBe(true);
  });

  it('flags ALTER TABLE ... RENAME TO (a table rename)', () => {
    expect(findUnapprovedNonAdditiveStatements('ALTER TABLE foo RENAME TO renamed_foo;')).toBe(true);
  });

  it('flags an instant SET NOT NULL on an existing column with no exception comment', () => {
    expect(findUnapprovedNonAdditiveStatements('ALTER TABLE foo ALTER COLUMN bar SET NOT NULL;')).toBe(true);
  });

  it('does not flag a rename carrying the expand/contract exception marker', () => {
    const content =
      '-- EXPAND-CONTRACT-EXCEPTION-APPROVED: platform-only table, single synchronous deploy\n' +
      'ALTER TABLE plans RENAME COLUMN old_name TO new_name;';
    expect(findUnapprovedNonAdditiveStatements(content)).toBe(false);
  });

  it('does not flag an ordinary additive migration (ADD COLUMN, nullable)', () => {
    expect(findUnapprovedNonAdditiveStatements('ALTER TABLE foo ADD COLUMN bar text;')).toBe(false);
  });

  it('does not flag NOT NULL declared inline on a brand-new ADD COLUMN (the expand phase itself, not a violation of it)', () => {
    expect(findUnapprovedNonAdditiveStatements("ALTER TABLE foo ADD COLUMN bar text NOT NULL DEFAULT '';")).toBe(
      false,
    );
  });
});
