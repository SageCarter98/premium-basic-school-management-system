/**
 * pipeline-security-gates.spec.ts
 *
 * NFR-SEC-020 (SRS v2.1 §33.5): "The release pipeline MUST include, as
 * blocking gates: static application security testing (SAST) on every pull
 * request; dependency and container vulnerability scanning on every build;
 * dynamic application security testing (DAST) against staging before
 * promotion to production; and an independent penetration test at minimum
 * annually and before General Availability. Critical or high findings block
 * release until remediated or formally risk-accepted by a named security
 * owner."
 *
 * Found via EC-107: the SAST and dependency-scan jobs already existed in
 * .github/workflows/ci.yml (added 2026-08-27, cited by ID in their own
 * comments) and already run on every pull request, but nothing ever checked
 * that they stay wired up as *blocking* gates -- a job silently downgraded
 * to `continue-on-error: true`, or a scan command loosened to no longer
 * fail the build, would defeat NFR-SEC-020 without any CI signal saying so.
 * This is a static check of ci.yml's own text, not a live pipeline run --
 * same shape as the NFR-SEC-010 BYPASSRLS regression guard, but as a fast
 * unit test rather than a new CI step, since it needs no database or live
 * infrastructure to verify.
 *
 * Honest scope: this only covers the two halves of NFR-SEC-020 that are
 * actually automatable pull-request/build-time gates. DAST against staging
 * and the independent annual/pre-GA penetration test are organisational
 * and environment-dependent (no staging environment exists yet -- see
 * ci.yml's own header comment); this suite does not claim to check either,
 * it only checks that ci.yml keeps stating that honestly rather than
 * silently dropping the caveat.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const CI_YML_PATH = join(__dirname, '../../../../.github/workflows/ci.yml');

function readCiYml(): string {
  return readFileSync(CI_YML_PATH, 'utf8');
}

/** Extracts one top-level job block ("  job-name:\n    ...") by name, up to the next top-level job or EOF. */
function extractJobBlock(ciYml: string, jobName: string): string {
  const jobHeaderPattern = new RegExp(`^  ${jobName}:\\s*$`, 'm');
  const startMatch = jobHeaderPattern.exec(ciYml);
  if (!startMatch) {
    throw new Error(`No top-level job named "${jobName}" found in ci.yml`);
  }
  const rest = ciYml.slice(startMatch.index + startMatch[0].length);
  const nextJobMatch = /\n {2}[a-zA-Z0-9_-]+:\s*\n/.exec(rest);
  return nextJobMatch ? rest.slice(0, nextJobMatch.index) : rest;
}

describe('NFR-SEC-020 pipeline security gates (SRS v2.1 §33.5)', () => {
  let ciYml: string;

  beforeAll(() => {
    ciYml = readCiYml();
  });

  it('runs on every pull request, not only on push to main', () => {
    expect(ciYml).toMatch(/^on:\s*\n(\s*pull_request:\s*\n)?/m);
    expect(ciYml).toContain('pull_request:');
  });

  describe('dependency and vulnerability scanning', () => {
    it('has a dependency-scan job citing NFR-SEC-020', () => {
      const block = extractJobBlock(ciYml, 'dependency-scan');
      expect(ciYml).toContain('# NFR-SEC-020');
      expect(block).toContain('npm audit');
    });

    it('is a blocking gate: no continue-on-error, and audit is set to fail on high/critical findings', () => {
      const block = extractJobBlock(ciYml, 'dependency-scan');
      expect(block).not.toMatch(/continue-on-error:\s*true/);
      const auditLine = block.split('\n').find((line) => /^\s*-?\s*run:.*npm audit/.test(line));
      expect(auditLine).toBeDefined();
      // "Critical or high findings block release" (NFR-SEC-020) -- npm audit's
      // own severity threshold is the mechanism; anything looser than "high"
      // (e.g. --audit-level=critical, or the flag dropped entirely) would let
      // high-severity findings through without failing the build.
      expect(auditLine).toMatch(/--audit-level=(high|moderate|low)/);
      // A bare pass/fail command is still meaningless if its exit code gets
      // swallowed right afterwards (`|| true`, `; exit 0`, `|| exit 0`) --
      // that silently un-blocks the gate without touching audit-level at all.
      expect(auditLine).not.toMatch(/\|\|\s*(true|exit 0)|;\s*exit 0/);
    });
  });

  describe('static application security testing (SAST)', () => {
    it('has a sast job citing NFR-SEC-020', () => {
      const block = extractJobBlock(ciYml, 'sast');
      expect(ciYml).toContain('# NFR-SEC-020');
      expect(block.toLowerCase()).toContain('semgrep');
    });

    it('is a blocking gate: no continue-on-error', () => {
      const block = extractJobBlock(ciYml, 'sast');
      expect(block).not.toMatch(/continue-on-error:\s*true/);
    });
  });

  describe('DAST and the independent penetration test', () => {
    it('honestly documents that DAST-against-staging and the pentest are not yet implemented, rather than silently omitting them', () => {
      // No staging environment exists yet (see CLAUDE.md / this file's own
      // header comment) -- these two halves of NFR-SEC-020 cannot be
      // automated by this repo's CI today. What this suite can check is that
      // ci.yml keeps saying so explicitly, so the gap stays a stated,
      // tracked limitation instead of quietly disappearing from view.
      expect(ciYml).toMatch(/staging deploy.*DAST.*production deploy are environment-specific/is);
    });

    it('has no job step that actually runs a DAST scan or a penetration test tool', () => {
      // The header comment above legitimately mentions "DAST" as a stated,
      // not-yet-built gap (checked above) -- what this asserts is that no
      // `run:`/`uses:` step has quietly started invoking one (zap, nikto,
      // burp, etc.) without the header, this test, and NFR-SEC-020's own
      // "environment-specific... Phase 1 build item" framing being updated
      // to match. A real addition should touch all three, deliberately.
      const stepLines = ciYml
        .split('\n')
        .filter((line) => /^\s*(run:|uses:)/.test(line))
        .join('\n')
        .toLowerCase();
      expect(stepLines).not.toMatch(/\bdast\b|zap|nikto|burp|penetration/);
    });
  });
});
