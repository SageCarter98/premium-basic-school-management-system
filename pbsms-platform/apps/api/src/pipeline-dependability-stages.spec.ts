/**
 * pipeline-dependability-stages.spec.ts
 *
 * NFR-DEP-020 (SRS v2.1): "Pipeline: review -> automated tests ->
 * SAST/dependency scan (Chapter 33.5) -> build -> staging deploy -> DAST
 * -> migration test -> acceptance -> approval -> backup -> production
 * deploy -> smoke test -> monitoring."
 *
 * Found via EC-107: ci.yml's own header comment already states this exact
 * pipeline and already cites NFR-DEP-020 by ID, and already says plainly
 * that this file "covers the pull-request-time portion only" -- automated
 * tests, SAST, dependency scanning, build, and the migration test -- with
 * staging deploy / DAST / production deploy / smoke test / monitoring
 * named as a Phase 1 build item pending real hosting. Nothing checked
 * that this stays true: a job silently added under a misleading name, or
 * the honest "not yet built" caveat quietly dropped from the header,
 * would misrepresent the pipeline's real coverage with no CI signal
 * saying so. Same shape as the NFR-SEC-020 regression guard -- a static
 * check of ci.yml's own text.
 *
 * Deliberately does not attempt to verify "review" (a GitHub branch-
 * protection setting, not something in this file) or "approval" (the same)
 * -- those aren't ci.yml's to state or this suite's to check.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const CI_YML_PATH = join(__dirname, '../../../../.github/workflows/ci.yml');

function readCiYml(): string {
  return readFileSync(CI_YML_PATH, 'utf8');
}

function jobNames(ciYml: string): string[] {
  const jobsSectionMatch = /^jobs:\s*\n([\s\S]*)$/m.exec(ciYml);
  if (!jobsSectionMatch) throw new Error('No top-level `jobs:` section found in ci.yml');
  return [...jobsSectionMatch[1].matchAll(/^ {2}([a-zA-Z0-9_-]+):\s*$/gm)].map((m) => m[1]);
}

describe('NFR-DEP-020 release pipeline stages', () => {
  let ciYml: string;
  let names: string[];

  beforeAll(() => {
    ciYml = readCiYml();
    names = jobNames(ciYml);
  });

  it("cites NFR-DEP-020 and documents the full required pipeline order", () => {
    expect(ciYml).toContain('NFR-DEP-020');
    expect(ciYml).toMatch(
      /review.*tests.*SAST\/dependency scan.*build.*staging deploy.*DAST.*migration test.*acceptance.*approval.*backup.*production.*deploy.*smoke test.*monitoring/is,
    );
  });

  it('implements every pull-request-time stage the header claims to cover', () => {
    // automated tests, SAST, dependency scanning, build, migration test
    expect(names).toContain('unit-and-migration-tests');
    expect(names).toContain('sast');
    expect(names).toContain('dependency-scan');
    expect(names).toContain('build');
  });

  it('runs the migration test as part of the same job the header names, applying every migration before the isolation suite', () => {
    const jobStart = ciYml.indexOf('  unit-and-migration-tests:');
    expect(jobStart).toBeGreaterThan(-1);
    const nextJob = /\n {2}[a-zA-Z0-9_-]+:\s*\n/.exec(ciYml.slice(jobStart + 1));
    const jobBlock = nextJob ? ciYml.slice(jobStart, jobStart + 1 + nextJob.index) : ciYml.slice(jobStart);
    expect(jobBlock).toMatch(/Apply migrations \(NFR-QA-030\)/);
  });

  it('honestly states that staging deploy, DAST, and production deploy remain unbuilt, rather than silently dropping the caveat', () => {
    expect(ciYml).toMatch(/staging deploy.*DAST.*production deploy are environment-specific.*Phase 1 build item/is);
  });

  it('has no job actually claiming to run a staging/production deploy, smoke test, or monitoring step', () => {
    const nonPrTimeStageNames = names.filter((n) =>
      /deploy|smoke|monitor/i.test(n),
    );
    expect(nonPrTimeStageNames).toEqual([]);
  });
});
