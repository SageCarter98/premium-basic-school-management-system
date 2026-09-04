/**
 * pipeline-accessibility-gate.spec.ts
 *
 * NFR-ACC-020 (SRS v2.1 §36-adjacent accessibility section): "Automated
 * accessibility checks (axe-core or equivalent) run in CI on every pull
 * request touching frontend code and block merge on new critical
 * violations."
 *
 * Found via EC-107: the `web-a11y` job in ci.yml already runs pa11y-ci
 * (which drives HTML_CodeSniffer by default -- an "equivalent" automated
 * WCAG checker to axe-core, same standard: WCAG2AA) against every real
 * frontend route on every pull request, and already cites NFR-ACC-020 in
 * its own header comment -- but nothing checked that this stays wired up
 * as a real, blocking, non-trivial gate. Same shape as the NFR-SEC-020
 * regression guard: a static check of ci.yml and .pa11yci.json's own
 * text, not a live pipeline run, since it needs no browser or live
 * infrastructure to verify.
 *
 * "Block merge on new critical violations" is satisfied here by something
 * stricter, not something looser: .pa11yci.json sets no `threshold`
 * (pa11y-ci's default is 0), so the job fails on *any* WCAG2AA violation
 * pa11y detects, not only new or only critical ones -- there is no
 * pre-existing-violation baseline to be "new" relative to. A `threshold`
 * key appearing (loosening this to tolerate some violation count) is
 * exactly the kind of quiet regression this suite exists to catch.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const CI_YML_PATH = join(__dirname, '../../../../.github/workflows/ci.yml');
const PA11YCI_JSON_PATH = join(__dirname, '../../web/.pa11yci.json');

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

describe('NFR-ACC-020 automated accessibility gate', () => {
  let ciYml: string;
  let block: string;
  let pa11yConfig: { defaults?: { standard?: string; threshold?: number }; urls?: string[] };

  beforeAll(() => {
    ciYml = readCiYml();
    block = extractJobBlock(ciYml, 'web-a11y');
    pa11yConfig = JSON.parse(readFileSync(PA11YCI_JSON_PATH, 'utf8'));
  });

  it('runs on every pull request (ci.yml has no per-job path filter narrowing this to some PRs only)', () => {
    expect(ciYml).toMatch(/^on:\s*\n(\s*pull_request:\s*\n)?/m);
    expect(ciYml).toContain('pull_request:');
    expect(block).not.toMatch(/^\s*if:/m);
  });

  it('has a web-a11y job citing NFR-ACC-020, running pa11y-ci', () => {
    expect(ciYml).toContain('# NFR-ACC-020');
    expect(block).toContain('npm run a11y --workspace apps/web');
  });

  it('is a blocking gate: no continue-on-error', () => {
    expect(block).not.toMatch(/continue-on-error:\s*true/);
  });

  it('checks the WCAG2AA standard the requirement names', () => {
    expect(pa11yConfig.defaults?.standard).toBe('WCAG2AA');
  });

  it('has no violation-count threshold, i.e. fails on any violation rather than tolerating some', () => {
    expect(pa11yConfig.defaults?.threshold).toBeUndefined();
  });

  it('crawls at least one real, authenticated-workflow-independent route so the gate exercises actual DOM', () => {
    expect(pa11yConfig.urls?.length ?? 0).toBeGreaterThan(0);
    expect(pa11yConfig.urls).toContain('http://localhost:3000/design-system');
  });
});
