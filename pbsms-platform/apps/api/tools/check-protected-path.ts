/**
 * EC-500 (CLAUDE.md "Internal Engineering Agent" section): fails when a
 * diff touches a CODEOWNERS-protected path and the PR doesn't carry the
 * `protected-zone` label. CODEOWNERS + branch protection already force a
 * human review on these paths regardless — this gate is a second,
 * CI-visible signal that a reviewer can see at a glance without opening
 * the diff, and it forces whoever opens the PR to consciously acknowledge
 * "yes, this touches a protected zone" rather than relying only on
 * GitHub's own review requirement quietly doing its job.
 *
 * Parses `.github/CODEOWNERS` directly at runtime rather than duplicating
 * its path list in a second array — unlike EC-501's three protected test
 * files (which change rarely), CODEOWNERS' protected-zone list is exactly
 * the kind of thing that grows over time, and a duplicated list drifts.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const OVERRIDE_LABEL = 'protected-zone';

function protectedPathPatterns(repoRoot: string): string[] {
  const codeowners = readFileSync(join(repoRoot, '.github', 'CODEOWNERS'), 'utf8');
  return codeowners
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);
}

function changedFiles(baseSha: string, repoRoot: string): string[] {
  // cwd pinned to repoRoot so returned paths are repo-root-relative, matching
  // CODEOWNERS' own path format — `git diff --name-only` paths are otherwise
  // resolved relative to cwd, not the repo root.
  const out = execFileSync('git', ['diff', '--name-only', `${baseSha}...HEAD`], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function matchesPattern(repoRelativePath: string, pattern: string): boolean {
  // CODEOWNERS patterns here are always a leading-/ directory or exact file
  // path, repo-root-relative — no globs in this file today. A directory
  // pattern (trailing /) matches anything under it; a file pattern matches
  // exactly.
  const normalizedPattern = pattern.replace(/^\//, '');
  if (normalizedPattern.endsWith('/')) {
    return `${repoRelativePath}/`.startsWith(normalizedPattern) || repoRelativePath.startsWith(normalizedPattern);
  }
  return repoRelativePath === normalizedPattern;
}

function hasOverrideLabel(): boolean {
  try {
    const labels: string[] = JSON.parse(process.env.PR_LABELS ?? '[]');
    return labels.includes(OVERRIDE_LABEL);
  } catch {
    return false;
  }
}

function main(): void {
  const baseSha = process.env.EC500_BASE_SHA;
  if (!baseSha || /^0+$/.test(baseSha)) {
    console.log('EC-500: no usable base commit — skipping.');
    return;
  }

  // apps/api/tools -> apps/api -> apps -> pbsms-platform -> repo root
  const repoRoot = join(__dirname, '..', '..', '..', '..');
  const patterns = protectedPathPatterns(repoRoot);
  const files = changedFiles(baseSha, repoRoot);

  const touchedZones = new Set<string>();
  for (const file of files) {
    for (const pattern of patterns) {
      if (matchesPattern(file, pattern)) {
        touchedZones.add(pattern);
      }
    }
  }

  if (touchedZones.size === 0) {
    console.log('EC-500: no protected-zone paths touched.');
    return;
  }

  if (hasOverrideLabel()) {
    console.log(
      `EC-500: touches ${touchedZones.size} protected zone(s), correctly labelled '${OVERRIDE_LABEL}':\n` +
        [...touchedZones].map((z) => `  - ${z}`).join('\n'),
    );
    return;
  }

  console.error(
    `EC-500: this diff touches ${touchedZones.size} CODEOWNERS-protected zone(s) without the ` +
      `'${OVERRIDE_LABEL}' label:\n` +
      [...touchedZones].map((z) => `  - ${z}`).join('\n') +
      `\n\nAdd the '${OVERRIDE_LABEL}' label — CODEOWNERS review is still required regardless, ` +
      'this just makes it visible on the PR itself.',
  );
  process.exitCode = 1;
}

main();
