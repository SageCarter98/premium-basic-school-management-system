/**
 * EC-504 (CLAUDE.md "Internal Engineering Agent" section): fails when a
 * pull request references no SRS requirement ID and no EC- process ID in
 * its title or body. A PR that can't point to what it implements or
 * changes is exactly the "scope creep in a single PR" failure mode
 * CLAUDE.md names elsewhere — this makes it visible before review, not
 * after.
 *
 * Unlike detect-spec-gaps.ts (EC-107), which must stay strictly SRS-only
 * to avoid reporting nonsense like "EC-501 is unimplemented", this check
 * deliberately ALSO accepts EC- IDs: a process/tooling PR (e.g. "Build
 * EC-501: ...") is exactly as legitimately traceable as a product PR
 * citing FR-RES-020, and this repo's actual PR history already does this.
 */
import { SRS_ID_PREFIXES } from './requirement-id-prefixes';

const ID_PATTERN = new RegExp(`\\b(${[...SRS_ID_PREFIXES, 'EC'].join('|')})-[A-Z]*-?[0-9]{2,4}\\b`);

function main(): void {
  const title = process.env.PR_TITLE ?? '';
  const body = process.env.PR_BODY ?? '';

  if (!title && !body) {
    console.log('EC-504: no PR_TITLE/PR_BODY set (not a pull_request event) — skipping.');
    return;
  }

  if (ID_PATTERN.test(title) || ID_PATTERN.test(body)) {
    console.log('EC-504: PR references at least one requirement/process ID.');
    return;
  }

  console.error(
    "EC-504: this PR's title and body reference no SRS requirement ID (FR-/NFR-/TEN-/DP-/BR-/SEC-)\n" +
      "and no EC- process ID. Add one — say what this change implements or changes, or which EC rule\n" +
      "it builds. See CLAUDE.md's CI gates table (EC-504).",
  );
  process.exitCode = 1;
}

main();
