/**
 * NFR-QA-040: "Every requirement ID in this document (Appendix A) MUST map
 * to design, implementation, database change, API, permission rule,
 * automated test and acceptance evidence before the owning chapter is
 * marked complete."
 *
 * A standing, re-runnable report rather than a one-time hand-typed matrix
 * -- a hand-typed matrix goes stale the moment the next PR merges, exactly
 * the kind of drift CLAUDE.md's own "2026-08-27 documentation drift" note
 * (this file's sibling, detect-spec-gaps.ts, once claimed several CI gates
 * were "not built" when they'd shipped days earlier) already caught once.
 *
 * Reuses detect-spec-gaps.ts's own SRS extraction and reference search
 * (EC-107) rather than re-implementing it, then classifies each reference
 * into finer categories via file-level heuristics:
 *   - db (database change): any referencing file lives under
 *     infra/migrations/
 *   - api: any referencing file contains an @Controller( decorator
 *   - perm (permission rule): any referencing file contains a @Roles(
 *     decorator
 *   - test: the same isTestFile() shape detect-spec-gaps.ts uses
 *   - impl (implementation): any reference at all, the same definition
 *     EC-107 already uses
 *
 * Two of NFR-QA-040's seven named categories -- design and acceptance
 * evidence -- have no automatable signal in a git grep and are NOT faked
 * here: every row reports them as "manual", always. A design rationale
 * can live in a code comment, a spec document, or nowhere; an acceptance
 * sign-off is a human decision (the PM/SDLC tracker's own gate-decision
 * mechanism), not something derivable from source text. Reporting a
 * confident-looking Y/N for either would be exactly the "falsified
 * evidence" failure mode CLAUDE.md's own backfill-verification section
 * warns about.
 *
 * These file-level heuristics are coarse (a file containing @Roles(
 * ANYWHERE counts as a hit, not necessarily on the exact route
 * implementing this specific ID) -- the same "loose substring match
 * trades false positives for not missing a real reference" trade-off
 * detect-spec-gaps.ts's own header documents choosing deliberately. Run
 * manually (`npm run traceability:report --workspace apps/api`), not a CI
 * gate -- same posture as detect-spec-gaps.ts.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SRS_ID_PREFIXES } from './requirement-id-prefixes';

const SRS_EXTRACT_FILENAME = 'srs_v21_extract.txt';
// Mirrors detect-spec-gaps.ts's own IMPLEMENTATION_DIRS/isTestFile exactly
// -- duplicated rather than imported so this file has no runtime
// dependency on that one's internals; both are small enough that keeping
// them in sync by inspection (they're right next to each other in this
// same tools/ directory) is cheaper than a shared-module refactor for two
// four-line functions.
const IMPLEMENTATION_DIRS = [
  'pbsms-platform/apps/api/src',
  'pbsms-platform/apps/api/test',
  'pbsms-platform/apps/web/src',
  'pbsms-platform/infra/migrations',
  '.github/workflows',
];

function isTestFile(repoRelativePath: string): boolean {
  return (
    repoRelativePath.startsWith('pbsms-platform/apps/api/test/') ||
    /\.(test|spec)\.tsx?$/.test(repoRelativePath) ||
    /\/__tests__\//.test(repoRelativePath)
  );
}

function isMigrationFile(repoRelativePath: string): boolean {
  return repoRelativePath.startsWith('pbsms-platform/infra/migrations/');
}

const DEFINITION_PATTERN = new RegExp(`^\\s*((?:${SRS_ID_PREFIXES.join('|')})-[A-Z]+-?[0-9]{2,3})(?=:)`);

function extractDefinedIds(srsText: string): string[] {
  const ids = new Set<string>();
  for (const line of srsText.split('\n')) {
    const match = DEFINITION_PATTERN.exec(line);
    if (match) ids.add(match[1]);
  }
  return [...ids].sort();
}

function grepReferences(repoRoot: string, id: string): string[] {
  try {
    const out = execFileSync('git', ['grep', '-l', '-F', id, '--', ...IMPLEMENTATION_DIRS], {
      encoding: 'utf8',
      cwd: repoRoot,
    });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return []; // git grep exits 1 when there are no matches -- not an error here
  }
}

function fileMatches(repoRoot: string, repoRelativePath: string, pattern: RegExp): boolean {
  try {
    const content = readFileSync(join(repoRoot, repoRelativePath), 'utf8');
    return pattern.test(content);
  } catch {
    return false;
  }
}

interface TraceRow {
  id: string;
  impl: boolean;
  test: boolean;
  db: boolean;
  api: boolean;
  perm: boolean;
}

function buildRow(repoRoot: string, id: string): TraceRow {
  const refs = grepReferences(repoRoot, id);
  return {
    id,
    impl: refs.length > 0,
    test: refs.some(isTestFile),
    db: refs.some(isMigrationFile),
    api: refs.some((f) => fileMatches(repoRoot, f, /@Controller\(/)),
    perm: refs.some((f) => fileMatches(repoRoot, f, /@Roles\(/)),
  };
}

function cell(value: boolean): string {
  return value ? 'Y' : 'N';
}

function main(): void {
  const repoRoot = join(__dirname, '..', '..', '..', '..'); // apps/api/tools -> repo root
  const srsText = readFileSync(join(repoRoot, SRS_EXTRACT_FILENAME), 'utf8');
  const ids = extractDefinedIds(srsText);
  const rows = ids.map((id) => buildRow(repoRoot, id));

  console.log(`NFR-QA-040: traceability report for ${rows.length} SRS requirement IDs.\n`);
  console.log(
    'Columns below (impl/test/db/api/perm) are automated Y/N from source-text detection.\n' +
      "design and acceptance-evidence are NOT included as columns -- they have no automatable\n" +
      'signal and are always a human judgement call; see this file\'s own header for why faking\n' +
      'a Y/N for either would be worse than omitting them.\n',
  );

  const header = 'ID'.padEnd(16) + 'impl'.padEnd(6) + 'test'.padEnd(6) + 'db'.padEnd(4) + 'api'.padEnd(5) + 'perm';
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const row of rows) {
    console.log(
      row.id.padEnd(16) +
        cell(row.impl).padEnd(6) +
        cell(row.test).padEnd(6) +
        cell(row.db).padEnd(4) +
        cell(row.api).padEnd(5) +
        cell(row.perm),
    );
  }

  const implAndTested = rows.filter((r) => r.impl && r.test).length;
  const implNoTest = rows.filter((r) => r.impl && !r.test).length;
  const noImpl = rows.filter((r) => !r.impl).length;
  console.log(
    `\n${implAndTested}/${rows.length} have both impl and test (detect-spec-gaps.ts's own two columns).\n` +
      `${implNoTest}/${rows.length} have impl but no test.\n` +
      `${noImpl}/${rows.length} have no implementation reference at all.\n` +
      'db/api/perm are additional signal on top of that, not a replacement for it -- a requirement\n' +
      'can legitimately have none of the three (a pure business-rule/NFR with no migration, no new\n' +
      'endpoint, no role gate of its own) without that being a gap.',
  );
}

main();
