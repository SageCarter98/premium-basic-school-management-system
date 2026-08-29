/**
 * Chapter 47 Stage 2 (§47.15.1, EC-400): "Every incorrect answer reported
 * by a tenant under FR-AIT-602 is added permanently. The set only grows."
 * — and, by the same logic CLAUDE.md's EC-400 already applies to the
 * three/four hand-authored *.e2e-spec.ts suites, a golden or adversarial
 * CASE, once merged, should only ever be added to or left alone, never
 * quietly narrowed or deleted.
 *
 * check-protected-tests.ts (EC-501) enforces exactly that shape for
 * `it(...)`/`test(...)` call expressions — but golden-cases.ts and
 * adversarial-cases.ts aren't hand-authored test bodies, they're DATA:
 * arrays of case objects built by loops (`for (const role of ROLES) for
 * (const threshold of THRESHOLDS) cases.push({ id: \`...${role}...\`, ... })`),
 * most with a runtime-interpolated `id`. A static AST pass (this script's
 * FIRST version) can only see string-LITERAL ids — it silently missed
 * every loop-generated case, which is most of golden-cases.ts. Caught
 * live: a smoke test that tampered with an existing loop-generated case
 * produced zero violations from the AST version.
 *
 * Fixed by requiring the actual modules instead of parsing source text:
 * this script `require()`s golden-cases.ts/adversarial-cases.ts BOTH at
 * HEAD (the normal `require`, already running under ts-node) AND at the
 * PR's base commit (materialised into a throwaway temp directory via `git
 * show`, with a symlinked `src/` so their `../../src/...` imports still
 * resolve), then diffs the two REAL, fully-computed case arrays by `id`.
 * This is immune to how a case's `id` or fields are constructed in
 * source — literal, templated, computed — because by the time this
 * script sees them, the loops have already run.
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

// Every file golden-cases.ts/adversarial-cases.ts need (transitively) to
// be require()-able from a standalone copy of this directory: their own
// module graph within tenant-ai-assistant-eval/, nothing from test/ itself.
const EVAL_DIR = 'pbsms-platform/apps/api/test/tenant-ai-assistant-eval';
const EVAL_MODULE_FILES = ['fixtures.ts', 'oracle.ts', 'role-coverage.ts', 'golden-cases.ts', 'adversarial-cases.ts'];

interface CaseModule {
  repoRelativePath: string;
  exportName: 'GOLDEN_CASES' | 'ADVERSARIAL_CASES';
}

const CASE_MODULES: CaseModule[] = [
  { repoRelativePath: `${EVAL_DIR}/golden-cases.ts`, exportName: 'GOLDEN_CASES' },
  { repoRelativePath: `${EVAL_DIR}/adversarial-cases.ts`, exportName: 'ADVERSARIAL_CASES' },
];

interface CaseLike {
  id: string;
  [key: string]: unknown;
}

/** Set/Map don't survive JSON.stringify meaningfully (OracleScope.classKeys is a Set) — this makes them comparable, and sorts object keys so field-reordering alone never looks like a change. */
function toComparable(value: unknown): unknown {
  if (value instanceof Set) return [...value].sort();
  if (Array.isArray(value)) return value.map(toComparable);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = toComparable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function hashCase(c: unknown): string {
  return createHash('sha256').update(JSON.stringify(toComparable(c))).digest('hex');
}

function readAtBase(baseSha: string, repoRelativePath: string): string | null {
  try {
    return execFileSync('git', ['show', `${baseSha}:${repoRelativePath}`], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

/** Materialises the base commit's version of the eval module graph into a temp dir and requires `exportName` from it. Returns null if the file didn't exist at base (new this PR — nothing to protect yet). */
function loadCasesAtBase(repoRoot: string, baseSha: string, targetFile: string, exportName: string): CaseLike[] | null {
  const targetSource = readAtBase(baseSha, targetFile);
  if (targetSource === null) return null;

  // Deliberately placed INSIDE apps/api, not the OS temp dir: `pg` and
  // every other bare-specifier import fixtures.ts pulls in resolve via
  // Node's normal upward node_modules walk, which only finds anything if
  // the temp dir's ancestry actually includes apps/api/node_modules — an
  // OS-level /tmp directory has no such ancestry and fails to resolve
  // `pg` at all. Caught live: the first version of this fix used
  // os.tmpdir() and failed loudly (as designed — see the try/catch around
  // this function's call site) rather than silently, which is what
  // surfaced the mistake.
  const tmpRoot = mkdtempSync(join(repoRoot, 'pbsms-platform', 'apps', 'api', '.assistant-eval-integrity-tmp-'));
  try {
    const tmpEvalDir = join(tmpRoot, 'test', 'tenant-ai-assistant-eval');
    mkdirSync(tmpEvalDir, { recursive: true });
    // Every sibling module the target might import, at the SAME base
    // commit — a real cross-file change (e.g. oracle.ts's rounding logic)
    // should be visible in the diff too, not just golden-cases.ts itself.
    for (const file of EVAL_MODULE_FILES) {
      const source = readAtBase(baseSha, `${EVAL_DIR}/${file}`) ?? readFileFromRepo(repoRoot, `${EVAL_DIR}/${file}`);
      writeFileSync(join(tmpEvalDir, file), source);
    }
    // fixtures.ts/role-coverage.ts import from '../../src/...' — resolved
    // against the CURRENT (head) src/ tree, not base's. That's deliberate:
    // this check's job is to detect a case's DATA silently regressing,
    // not to re-litigate src/ history, and src/ changes are already
    // covered by ordinary review + the rest of this repo's test suites.
    symlinkSync(join(repoRoot, 'pbsms-platform', 'apps', 'api', 'src'), join(tmpRoot, 'src'), 'dir');

    const targetRelative = targetFile.slice(EVAL_DIR.length + 1);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(join(tmpEvalDir, targetRelative));
    const cases = mod[exportName];
    if (!Array.isArray(cases)) throw new Error(`${targetFile}@${baseSha.slice(0, 12)}: export '${exportName}' is not an array`);
    return cases as CaseLike[];
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function readFileFromRepo(repoRoot: string, repoRelativePath: string): string {
  // Used only as a fallback for a sibling module that's genuinely new
  // since base (e.g. this PR adds role-coverage.ts alongside an edit to
  // an already-existing golden-cases.ts in some future PR) — falls back
  // to HEAD's copy so the require() graph still resolves.
  return readFileSync(join(repoRoot, repoRelativePath), 'utf8');
}

function main(): void {
  const baseSha = process.env.EC_EVAL_BASE_SHA;
  if (!baseSha || /^0+$/.test(baseSha)) {
    console.log('check-assistant-eval-integrity: no usable base commit (first push, or an unknown base) — skipping.');
    return;
  }

  // apps/api/tools -> apps/api -> apps -> pbsms-platform -> repo root
  const repoRoot = join(__dirname, '..', '..', '..', '..');
  const violations: string[] = [];

  for (const { repoRelativePath, exportName } of CASE_MODULES) {
    const headAbsolutePath = join(repoRoot, repoRelativePath);
    let baseCases: CaseLike[] | null;
    try {
      baseCases = loadCasesAtBase(repoRoot, baseSha, repoRelativePath, exportName);
    } catch (err) {
      violations.push(`${repoRelativePath}: could not load the base-commit version to compare (${(err as Error).message}) — treating as a violation rather than silently skipping.`);
      continue;
    }
    if (baseCases === null) continue; // new file this PR — nothing to protect yet

    if (!existsSync(headAbsolutePath)) {
      violations.push(`${repoRelativePath}: existed at base ${baseSha.slice(0, 12)} but is deleted now.`);
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const headMod = require(headAbsolutePath);
    const headCases: CaseLike[] = headMod[exportName];
    const headById = new Map(headCases.map((c) => [c.id, c]));

    const seenIds = new Set<string>();
    for (const baseCase of baseCases) {
      if (seenIds.has(baseCase.id)) continue; // a duplicate id at base is a pre-existing authoring bug, not this check's job
      seenIds.add(baseCase.id);

      const headCase = headById.get(baseCase.id);
      if (!headCase) {
        violations.push(`${repoRelativePath}: case '${baseCase.id}' was removed (present at base ${baseSha.slice(0, 12)}, missing at head).`);
        continue;
      }
      if (hashCase(headCase) !== hashCase(baseCase)) {
        violations.push(`${repoRelativePath}: case '${baseCase.id}' was modified (its fields no longer match what was at base ${baseSha.slice(0, 12)}).`);
      }
    }
  }

  if (violations.length > 0) {
    console.error('check-assistant-eval-integrity: an existing golden/adversarial case was changed or removed:\n');
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      '\nAdding a NEW case (a new `id`) is always fine. Modifying or deleting an EXISTING case requires a\n' +
        'deliberate, human-reviewed decision — see CLAUDE.md EC-400 and this PR for how this differs from EC-501.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('check-assistant-eval-integrity: all golden/adversarial cases present at the base commit are still present, unmodified.');
}

main();
