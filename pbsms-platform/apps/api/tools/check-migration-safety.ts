/**
 * EC-502 (CLAUDE.md "Internal Engineering Agent" section): fails when a
 * migration added or changed in this PR contains a destructive statement
 * (DROP TABLE/COLUMN, ALTER...DROP, TRUNCATE, an unqualified DELETE) with
 * no explicit, diff-visible exception comment in the same file. The
 * exception isn't a bypass flag hidden in CI config — it's a sentence in
 * the migration itself, so the reviewer sees exactly what's being
 * accepted and why, in the same diff that carries the risk.
 *
 * NFR-DEP-030 (added via EC-107, 2026-09-04): "Migrations affecting
 * tenant-owned tables are additive-first (expand/contract pattern) so
 * that a mid-rollout state never leaves any tenant with a partially-
 * migrated, inconsistent schema." A separate check from the destructive-
 * statement one above — RENAME COLUMN/TABLE and an instant SET NOT NULL
 * on an existing column are not destructive (no data loss), but both
 * break expand/contract the same way a DROP does: old application code
 * still running against the pre-migration schema breaks the instant the
 * migration runs, not gradually across a rollout window. Neither pattern
 * tripped DESTRUCTIVE_PATTERNS above, so this was a genuinely unchecked
 * gap, not just a missing citation.
 */
import { execFileSync } from 'child_process';
import { join } from 'path';

// apps/api/tools -> apps/api -> apps -> pbsms-platform -> repo root. Pathspecs
// after `--` in `git diff`/`git log` resolve relative to cwd, NOT the repo
// root (unlike the `<rev>:<path>` blob-addressing syntax) — every git call
// below is pinned to repoRoot explicitly so repo-root-relative paths actually
// match, regardless of where `npm run` happens to set cwd.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const MIGRATIONS_PATHSPEC = 'pbsms-platform/infra/migrations/';

const DESTRUCTIVE_PATTERNS = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+column\b/i,
  /\balter\s+table\s+\S+\s+drop\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\s+\S+\s*;/i, // an unqualified DELETE — no WHERE before the terminator
];
const EXCEPTION_MARKER = /--\s*DESTRUCTIVE-MIGRATION-APPROVED:\s*\S/i;

// A rename is invisible to any reader still holding the old name (running
// application code, in-flight queries) the instant it runs; an instant
// SET NOT NULL on an *existing* column has no backfill guarantee the way
// ADD COLUMN ... NOT NULL DEFAULT does — both are contract-phase moves
// made without a preceding expand phase. Deliberately does not flag
// ADD COLUMN ... NOT NULL (with or without a DEFAULT): that's the expand
// phase itself, not a violation of it.
export const EXPAND_CONTRACT_PATTERNS = [
  /\balter\s+table\s+\S+\s+rename\s+column\b/i,
  /\balter\s+table\s+\S+\s+rename\s+to\b/i,
  /\balter\s+table\s+\S+\s+alter\s+column\s+\S+\s+set\s+not\s+null\b/i,
];
const EXPAND_CONTRACT_EXCEPTION_MARKER = /--\s*EXPAND-CONTRACT-EXCEPTION-APPROVED:\s*\S/i;

export function findUnapprovedDestructiveStatements(content: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(content)) && !EXCEPTION_MARKER.test(content);
}

export function findUnapprovedNonAdditiveStatements(content: string): boolean {
  return EXPAND_CONTRACT_PATTERNS.some((p) => p.test(content)) && !EXPAND_CONTRACT_EXCEPTION_MARKER.test(content);
}

function changedMigrationFiles(baseSha: string): string[] {
  const out = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACM', `${baseSha}...HEAD`, '--', MIGRATIONS_PATHSPEC],
    { encoding: 'utf8', cwd: REPO_ROOT },
  );
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function main(): void {
  const baseSha = process.env.EC502_BASE_SHA;
  if (!baseSha || /^0+$/.test(baseSha)) {
    console.log('EC-502: no usable base commit — skipping.');
    return;
  }

  const files = changedMigrationFiles(baseSha);
  if (files.length === 0) {
    console.log('EC-502: no migration files changed in this PR.');
    return;
  }

  const destructiveViolations: string[] = [];
  const nonAdditiveViolations: string[] = [];
  for (const repoRelativePath of files) {
    const content = execFileSync('git', ['show', `HEAD:${repoRelativePath}`], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    if (findUnapprovedDestructiveStatements(content)) destructiveViolations.push(repoRelativePath);
    if (findUnapprovedNonAdditiveStatements(content)) nonAdditiveViolations.push(repoRelativePath);
  }

  let failed = false;

  if (destructiveViolations.length > 0) {
    console.error('EC-502: destructive migration statement(s) with no explicit exception:\n');
    for (const v of destructiveViolations) console.error(`  - ${v}`);
    console.error(
      '\nAdd a comment stating the reason directly in the migration file, e.g.:\n' +
        '  -- DESTRUCTIVE-MIGRATION-APPROVED: dropping a column no code has read since 2026-08-01\n' +
        'A silent destructive change is not an option; a stated, reviewed one is.',
    );
    failed = true;
  }

  if (nonAdditiveViolations.length > 0) {
    console.error('EC-502 (NFR-DEP-030): non-additive migration statement(s) with no explicit exception:\n');
    for (const v of nonAdditiveViolations) console.error(`  - ${v}`);
    console.error(
      '\nRENAME COLUMN/TABLE and an instant SET NOT NULL on an existing column break the expand/contract\n' +
        'pattern NFR-DEP-030 requires -- old application code still running against the pre-migration schema\n' +
        'breaks the instant this runs, not gradually across a rollout. Split into an expand step (add the new\n' +
        "column, keep the old one, backfill, deploy code that writes both) now and a contract step (drop the\n" +
        'old column/apply the rename for real) in a LATER migration once every instance runs the new code --\n' +
        'or, if this is genuinely safe here (e.g. a platform-only table with one synchronous deploy), state why:\n' +
        '  -- EXPAND-CONTRACT-EXCEPTION-APPROVED: <reason>',
    );
    failed = true;
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  console.log('EC-502: no unapproved destructive or non-additive migration statements found.');
}

main();
