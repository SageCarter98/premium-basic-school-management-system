/**
 * api-versioning.spec.ts
 *
 * FR-API-020 ("The API is versioned (URI-prefixed, e.g. /v1/)..."), SRS
 * Chapter 32.1. See docs/api/FR-API-020-versioning-and-deprecation-policy.md
 * for the deprecation-policy half this file does not cover (there is
 * nothing to deprecate yet — v1/ is the only version that has ever
 * existed).
 *
 * A structural conformance check, not a live-HTTP test: reads every
 * *.controller.ts under modules/ and asserts its @Controller(...) path
 * starts with 'v1' (either exactly 'v1' or 'v1/...'). This is a real
 * regression guard — it fails the moment someone adds a new controller
 * without the prefix, which is exactly the mistake FR-API-020 exists to
 * prevent, and is genuinely untested before this file (no prior test
 * anywhere asserted anything about route prefixes).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const MODULES_DIR = join(__dirname, 'modules');
const CONTROLLER_DECORATOR = /@Controller\(\s*'([^']*)'\s*\)/g;

function findControllerFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...findControllerFiles(full));
    } else if (entry.endsWith('.controller.ts')) {
      found.push(full);
    }
  }
  return found;
}

describe('API versioning (FR-API-020)', () => {
  const controllerFiles = findControllerFiles(MODULES_DIR);

  it('found at least one controller to check (the check itself is not vacuous)', () => {
    expect(controllerFiles.length).toBeGreaterThan(30);
  });

  it('every @Controller(...) path is version-prefixed (v1, or v1/...)', () => {
    const unprefixed: string[] = [];
    for (const file of controllerFiles) {
      const source = readFileSync(file, 'utf8');
      const matches = [...source.matchAll(CONTROLLER_DECORATOR)];
      for (const [, path] of matches) {
        if (path !== 'v1' && !path.startsWith('v1/')) {
          unprefixed.push(`${file}: @Controller('${path}')`);
        }
      }
    }
    expect(unprefixed).toEqual([]);
  });
});
