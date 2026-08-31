/**
 * EC-507 (CLAUDE.md "Internal Engineering Agent" section): fails any
 * Agent-authored pull request whose diff touches the pbsms-ai/ tree at
 * all, including a rename or a move. Unlike EC-500 (CODEOWNERS zones),
 * there is no override label — the EC-005/EC-400 extension this gate
 * enforces gives this Agent read-only access to pbsms-ai/ once it exists,
 * not a draft-then-review path, so there is nothing to override.
 *
 * "Agent-authored" is detected the same way EC-506 does: presence of a
 * `Co-Authored-By: Claude ...` trailer on any commit in the PR. A PR with
 * no such trailer is treated as human-authored and is out of scope for
 * this gate — see CLAUDE.md's Chapter 47 build-authorization table:
 * pbsms-ai/'s Stage 1-2 content is meant to come from the Engineering
 * Lead, not this Agent, and this check must not block that.
 *
 * pbsms-ai/'s exact location is not yet fixed anywhere in this repo — no
 * primary source for the tree exists yet (see CLAUDE.md's Repository
 * state provenance note on the missing Internal Engineering Agent v2.1
 * PDF). This matches any path with a `pbsms-ai` directory segment,
 * wherever it ends up living (repo root or nested under pbsms-platform/),
 * rather than hardcoding one guessed location. Revisit once the tree
 * actually exists and its real path is known.
 */
import { execFileSync } from 'child_process';
import { join } from 'path';

const ATTRIBUTION_TRAILER = /co-authored-by:\s*claude/i;

function isAgentAuthored(baseSha: string, repoRoot: string): boolean {
  const log = execFileSync('git', ['log', `${baseSha}..HEAD`, '--format=%B'], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  return ATTRIBUTION_TRAILER.test(log);
}

function changedPaths(baseSha: string, repoRoot: string): string[] {
  // -M so a rename/move shows up as an R-status line with both the old and
  // new path, not just the new one — a rename out of pbsms-ai/ must be
  // caught exactly like a rename into it.
  const out = execFileSync('git', ['diff', '--name-status', '-M', `${baseSha}...HEAD`], {
    encoding: 'utf8',
    cwd: repoRoot,
  });

  const paths: string[] = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [status, ...rest] = trimmed.split('\t');
    if (status.startsWith('R') || status.startsWith('C')) {
      // Rename/copy: "R100  old/path  new/path" — both endpoints count.
      if (rest[0]) paths.push(rest[0]);
      if (rest[1]) paths.push(rest[1]);
    } else if (rest[0]) {
      paths.push(rest[0]);
    }
  }
  return paths;
}

function touchesPbsmsAi(repoRelativePath: string): boolean {
  return (
    repoRelativePath === 'pbsms-ai' ||
    repoRelativePath.startsWith('pbsms-ai/') ||
    repoRelativePath.includes('/pbsms-ai/')
  );
}

function main(): void {
  const baseSha = process.env.EC507_BASE_SHA;
  if (!baseSha || /^0+$/.test(baseSha)) {
    console.log('EC-507: no usable base commit — skipping.');
    return;
  }

  // apps/api/tools -> apps/api -> apps -> pbsms-platform -> repo root
  const repoRoot = join(__dirname, '..', '..', '..', '..');

  if (!isAgentAuthored(baseSha, repoRoot)) {
    console.log("EC-507: no Claude attribution trailer on this PR — not this Agent's work, skipping.");
    return;
  }

  const touched = changedPaths(baseSha, repoRoot).filter(touchesPbsmsAi);

  if (touched.length === 0) {
    console.log('EC-507: pbsms-ai/ tree not touched.');
    return;
  }

  console.error(
    `EC-507: this Agent-authored diff touches ${touched.length} path(s) under pbsms-ai/, ` +
      'which this Agent has read-only access to (CLAUDE.md EC-005/EC-400):\n' +
      touched.map((p) => `  - ${p}`).join('\n') +
      '\n\nThis content must come from the Engineering Lead, not this Agent — see CLAUDE.md\'s ' +
      'Chapter 47 build-authorization table (Stage 1-2).',
  );
  process.exitCode = 1;
}

main();
