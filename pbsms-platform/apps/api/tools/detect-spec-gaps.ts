/**
 * EC-107 (CLAUDE.md "Internal Engineering Agent" section): compares SRS
 * requirement IDs against the implementation and reports which ones have
 * no visible reference anywhere in `pbsms-platform/`, or are referenced
 * in code but never in a test. "Reported, not fixed" — deciding whether
 * an unimplemented requirement should be implemented, deferred, or
 * removed from the SRS is a product judgement this script doesn't make.
 * Run manually (`npm run detect:spec-gaps --workspace apps/api`), not a
 * CI gate.
 *
 * Two honest limitations, stated rather than hidden:
 *  - Extraction only recognises a requirement at its colon-delimited
 *    DEFINITION ("FR-ONB-010: The system MUST...") to avoid treating
 *    every loose in-prose mention (a range like "TEN-001..TEN-005", a
 *    slash list like "FR-RES-020/030") as a fresh requirement.
 *  - Reference-search is a plain substring match per ID against the
 *    implementation tree, which is deliberately loose (real references
 *    are ranges/slashes/prose, not a single machine-parseable token) —
 *    this trades a small false-positive risk for not missing a real
 *    reference, which would be the worse failure for a report a human
 *    is going to act on.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SRS_ID_PREFIXES } from './requirement-id-prefixes';

const SRS_EXTRACT_FILENAME = 'srs_v21_extract.txt';
const IMPLEMENTATION_DIRS = ['pbsms-platform/apps/api/src', 'pbsms-platform/apps/api/test', 'pbsms-platform/infra/migrations'];
const TEST_DIR_MARKER = 'pbsms-platform/apps/api/test';

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
    const out = execFileSync(
      'git',
      ['grep', '-l', '-F', id, '--', ...IMPLEMENTATION_DIRS],
      { encoding: 'utf8', cwd: repoRoot },
    );
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return []; // git grep exits 1 when there are no matches — not an error here
  }
}

function main(): void {
  const repoRoot = join(__dirname, '..', '..', '..', '..'); // apps/api/tools -> repo root
  const srsText = readFileSync(join(repoRoot, SRS_EXTRACT_FILENAME), 'utf8');
  const ids = extractDefinedIds(srsText);

  const unimplemented: string[] = [];
  const untested: string[] = [];

  for (const id of ids) {
    const refs = grepReferences(repoRoot, id);
    if (refs.length === 0) {
      unimplemented.push(id);
    } else if (!refs.some((f) => f.startsWith(TEST_DIR_MARKER))) {
      untested.push(id);
    }
  }

  console.log(`EC-107: ${ids.length} SRS requirement IDs extracted from ${SRS_EXTRACT_FILENAME}.\n`);

  console.log(`No reference anywhere in the implementation (${unimplemented.length}):`);
  for (const id of unimplemented) console.log(`  - ${id}`);

  console.log(`\nReferenced in code, but never in a test file (${untested.length}):`);
  for (const id of untested) console.log(`  - ${id}`);

  console.log(
    '\nThis is a report, not a fix list — EC-107 (EC-100/101 mirrors this posture for feedback): ' +
      'a human decides whether a gap means "build it", "defer it", or "the requirement itself needs ' +
      'revisiting." See CLAUDE.md.',
  );
}

main();
