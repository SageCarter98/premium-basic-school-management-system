/**
 * worker-process-isolation.spec.ts
 *
 * NFR-PERF-011 / FR-JOB-020 ("bulk operations run on a dedicated worker
 * pool, never request-serving capacity"). worker.ts's own header already
 * makes this exact claim -- "it never imports NestFactory.create()/
 * app.listen(), so it structurally cannot serve an HTTP request -- a
 * real, checkable property, not just a documented intent" -- but nothing
 * had ever checked it before this file. detect-spec-gaps.ts correctly
 * flagged NFR-PERF-011 as "referenced but untested."
 *
 * Why source-text analysis, not an integration test: worker.ts calls
 * bootstrap() unconditionally at module load (its last line) -- creating
 * real Postgres pools, starting three setInterval() polling loops, and
 * registering SIGINT/SIGTERM handlers. Importing it directly in a test
 * would actually run all of that against whatever WORKER_DATABASE_URL/
 * DATABASE_URL happen to be set, with no way to stop it cleanly
 * afterward -- not something a unit test should trigger as a side effect
 * of merely checking an import list. Reading its source text is also
 * exactly what the property itself is: an import-graph fact, not a
 * runtime behaviour, and the same TypeScript-source-inspection approach
 * apps/api/tools/check-protected-tests.ts and check-pbsms-ai-boundary.ts
 * already use for structural CI gates elsewhere in this repo.
 *
 * Same instinct migration-integrity.spec.ts's own header names: proving
 * the check itself actually catches a real violation, not just that it
 * passes vacuously on worker.ts. main.ts (the real HTTP entrypoint) is
 * asserted to DO import NestFactory and DO call .listen() -- a positive
 * control showing these exact patterns would have failed the same
 * assertions had worker.ts actually had them.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

/** Strips block and line comments before pattern-matching -- worker.ts's
 * own header comment quotes "NestFactory.create()/app.listen()" verbatim
 * while explaining what it does NOT do, which would otherwise make a
 * naive text search on the raw file trip on the very sentence documenting
 * the property, not the code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const workerSource = stripComments(readFileSync(resolve(__dirname, 'worker.ts'), 'utf-8'));
const mainSource = stripComments(readFileSync(resolve(__dirname, 'main.ts'), 'utf-8'));
const apiPackageJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as {
  scripts: Record<string, string>;
};

describe('stripComments()', () => {
  it('removes a block comment that itself quotes the pattern being checked for -- the exact false positive this file hit while being written: worker.ts\'s own header comment names "app.listen()" while documenting that it never calls it', () => {
    const source = `/** never calls app.listen() */\nconst x = 1;`;
    expect(stripComments(source)).not.toMatch(/\.listen\s*\(/);
    expect(stripComments(source)).toContain('const x = 1;');
  });

  it('removes a line comment the same way', () => {
    const source = `// mentions .listen( in passing\nconst x = 1;`;
    expect(stripComments(source)).not.toMatch(/\.listen\s*\(/);
  });

  it('leaves real code untouched', () => {
    const source = `app.listen(3000);`;
    expect(stripComments(source)).toMatch(/\.listen\s*\(/);
  });
});

describe('worker.ts is structurally incapable of serving an HTTP request (NFR-PERF-011)', () => {
  it('never imports NestFactory', () => {
    expect(workerSource).not.toMatch(/NestFactory/);
  });

  it('never calls .listen( (no HTTP server bind)', () => {
    expect(workerSource).not.toMatch(/\.listen\s*\(/);
  });

  it('never imports main.ts (the real HTTP entrypoint)', () => {
    expect(workerSource).not.toMatch(/from\s+['"]\.\/main['"]/);
  });

  // Positive control (see file header): the same two patterns above DO
  // appear in main.ts, proving they're real signals a violation in
  // worker.ts would actually trip, not a check that passes on anything.
  it('control: main.ts DOES import NestFactory and DOES call .listen( -- proving the checks above are meaningful', () => {
    expect(mainSource).toMatch(/NestFactory/);
    expect(mainSource).toMatch(/\.listen\s*\(/);
  });

  it('the worker/worker:dev npm scripts run worker.ts directly, never through the Nest CLI start/start:dev scripts', () => {
    const { worker, 'worker:dev': workerDev, start, 'start:dev': startDev } = apiPackageJson.scripts;
    expect(worker).toMatch(/worker\.js/);
    expect(workerDev).toMatch(/worker\.ts/);
    // start/start:dev go through `nest start`, which resolves Nest's own
    // entry file (main.ts) -- neither references worker.ts/worker.js at
    // all, confirming the process split exists at the script level too,
    // not just in worker.ts's own source.
    expect(start).not.toMatch(/worker/);
    expect(startDev).not.toMatch(/worker/);
  });
});
