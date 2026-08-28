/**
 * EC-501 (CLAUDE.md "Internal Engineering Agent" section): fails the build
 * if an EXISTING test case in one of the EC-400 protected suites listed in
 * PROTECTED_FILES below was modified or deleted between the PR's base
 * commit and the current working tree. Adding a NEW test case is always
 * allowed — only shrinking or altering what the base commit already
 * asserted is a violation. (Previously hardcoded "the three EC-400
 * protected suites" here — already stale by one file before this comment
 * was corrected; kept generic now so the count can't drift out of sync
 * with PROTECTED_FILES again.)
 *
 * This does not replace the CODEOWNERS review these files already require
 * (a human reviews every PR that touches them regardless). It closes the
 * narrower gap EC-501 names: a reviewer can see that a protected file
 * changed and still miss that one `it(...)` among fifty was quietly
 * weakened or dropped. Matching is by content hash, not title, so a test
 * whose title is kept but whose body was gutted still fails.
 *
 * Deliberately no real TS/JS parsing library beyond the `typescript`
 * compiler API this repo already depends on (ts-node/ts-jest) — AST-based
 * extraction of `it(...)`/`test(...)` call expressions is robust to nested
 * braces, strings and template literals in a way a regex scan would not be.
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

// Repo-root-relative paths, matching .github/CODEOWNERS's EC-400 list exactly.
const PROTECTED_FILES = [
  'pbsms-platform/apps/api/test/tenant-isolation.e2e-spec.ts',
  'pbsms-platform/apps/api/test/finance-invariants.e2e-spec.ts',
  'pbsms-platform/apps/api/test/results-immutability.e2e-spec.ts',
  'pbsms-platform/apps/api/test/tenant-ai-assistant-isolation.e2e-spec.ts',
  // Chapter 47 Stage 2 (§47.15): the eval harness's own it()/test() bodies
  // — structural checks, route-coverage checks, the §47.15.2 threshold
  // assertion, and the shared golden/adversarial comparison logic these
  // loops call. The golden-set and adversarial-corpus DATA this file
  // loops over live in tenant-ai-assistant-eval/golden-cases.ts and
  // adversarial-cases.ts instead — data arrays, not it()/test() calls, so
  // EC-501's call-expression hashing can't see them; see
  // check-assistant-eval-integrity.ts for their id-keyed equivalent.
  'pbsms-platform/apps/api/test/tenant-ai-assistant-eval.eval-spec.ts',
];

interface TestCase {
  title: string;
  hash: string;
  line: number;
}

function calleeRootName(expr: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  // covers it.skip/it.only/it.each and the same for test.*
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  return null;
}

function extractCases(source: string, fileName: string): TestCase[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2021, true);
  const cases: TestCase[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const name = calleeRootName(node.expression);
      if (name === 'it' || name === 'test') {
        const titleArg = node.arguments[0];
        const title =
          titleArg && ts.isStringLiteralLike(titleArg) ? titleArg.text : '<dynamically computed title>';
        // Whitespace-insensitive so reformatting alone doesn't trip this;
        // any actual wording/logic change still changes the hash.
        const normalized = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
        const hash = createHash('sha256').update(normalized).digest('hex');
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        cases.push({ title, hash, line: line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return cases;
}

function readAtBase(baseSha: string, repoRelativePath: string): string | null {
  try {
    return execFileSync('git', ['show', `${baseSha}:${repoRelativePath}`], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return null; // file didn't exist at base — nothing to protect yet
  }
}

function main(): void {
  const baseSha = process.env.EC501_BASE_SHA;
  if (!baseSha || /^0+$/.test(baseSha)) {
    console.log('EC-501: no usable base commit (first push, or an unknown base) — skipping.');
    return;
  }

  // apps/api/tools -> apps/api -> apps -> pbsms-platform -> repo root
  const repoRoot = join(__dirname, '..', '..', '..', '..');
  const violations: string[] = [];

  for (const repoRelativePath of PROTECTED_FILES) {
    const baseSource = readAtBase(baseSha, repoRelativePath);
    if (baseSource === null) continue; // new file this PR — nothing to protect yet

    const absolutePath = join(repoRoot, repoRelativePath);
    if (!existsSync(absolutePath)) {
      violations.push(`${repoRelativePath}: existed at base ${baseSha.slice(0, 12)} but is deleted now.`);
      continue;
    }
    const headSource = readFileSync(absolutePath, 'utf8');

    const baseCases = extractCases(baseSource, repoRelativePath);
    const headCases = extractCases(headSource, repoRelativePath);

    const headHashCounts = new Map<string, number>();
    for (const c of headCases) headHashCounts.set(c.hash, (headHashCounts.get(c.hash) ?? 0) + 1);

    for (const baseCase of baseCases) {
      const remaining = headHashCounts.get(baseCase.hash) ?? 0;
      if (remaining > 0) {
        headHashCounts.set(baseCase.hash, remaining - 1);
        continue;
      }
      const stillPresentByTitle = headCases.some((h) => h.title === baseCase.title);
      const verb = stillPresentByTitle ? 'modified' : 'removed';
      violations.push(
        `${repoRelativePath}:${baseCase.line}  "${baseCase.title}" was ${verb} ` +
          `(present at base ${baseSha.slice(0, 12)}, not found unchanged now).`,
      );
    }
  }

  if (violations.length > 0) {
    console.error('EC-501: existing test case(s) in a protected suite were changed or removed:\n');
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      '\nAdding a NEW test case to these files is always fine. Modifying or deleting an EXISTING\n' +
        'one requires a deliberate, human-reviewed decision — see CLAUDE.md EC-400/EC-501.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('EC-501: all protected-suite test cases present at the base commit are still present, unmodified.');
}

main();
