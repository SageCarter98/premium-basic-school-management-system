/**
 * EC-502 (CLAUDE.md "Internal Engineering Agent" section): fails when a
 * migration added or changed in this PR contains a destructive statement
 * (DROP TABLE/COLUMN, ALTER...DROP, TRUNCATE, an unqualified DELETE) with
 * no explicit, diff-visible exception comment in the same file. The
 * exception isn't a bypass flag hidden in CI config — it's a sentence in
 * the migration itself, so the reviewer sees exactly what's being
 * accepted and why, in the same diff that carries the risk.
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

  const violations: string[] = [];
  for (const repoRelativePath of files) {
    const content = execFileSync('git', ['show', `HEAD:${repoRelativePath}`], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    const hasDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(content));
    if (hasDestructive && !EXCEPTION_MARKER.test(content)) {
      violations.push(repoRelativePath);
    }
  }

  if (violations.length > 0) {
    console.error('EC-502: destructive migration statement(s) with no explicit exception:\n');
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      '\nAdd a comment stating the reason directly in the migration file, e.g.:\n' +
        '  -- DESTRUCTIVE-MIGRATION-APPROVED: dropping a column no code has read since 2026-08-01\n' +
        'A silent destructive change is not an option; a stated, reviewed one is.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('EC-502: no unapproved destructive migration statements found.');
}

main();
