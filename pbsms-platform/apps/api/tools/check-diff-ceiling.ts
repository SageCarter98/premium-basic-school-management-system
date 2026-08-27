/**
 * EC-503 (CLAUDE.md "Internal Engineering Agent" section): fails when a
 * PR's total changed lines exceed a reviewable-size ceiling. The 400-line
 * figure below is explicitly a guess in the spec's own Open Questions —
 * "re-set it from stage-3 measurement of how review quality actually
 * degrades with diff size on this team" — so it's a named constant, not
 * a magic number, and this script says so in its own output rather than
 * asserting it as settled.
 *
 * A `diff-ceiling-exception` label overrides this for a PR a reviewer has
 * explicitly agreed is one reviewable unit despite its size (e.g. a
 * mechanical rename, or a single cohesive rewrite like this file's own
 * CLAUDE.md section rewrite earlier the same day) — the override is
 * visible on the PR itself, not a silent bypass.
 */
import { execFileSync } from 'child_process';

const DIFF_CEILING_LINES = 400; // a guess per the spec's own Sec13 — re-set from measurement, not argument
const OVERRIDE_LABEL = 'diff-ceiling-exception';

function changedLineCount(baseSha: string): number {
  const out = execFileSync('git', ['diff', '--shortstat', `${baseSha}...HEAD`], { encoding: 'utf8' });
  // e.g. " 3 files changed, 42 insertions(+), 7 deletions(-)"
  const insertions = /(\d+) insertion/.exec(out);
  const deletions = /(\d+) deletion/.exec(out);
  return (insertions ? Number(insertions[1]) : 0) + (deletions ? Number(deletions[1]) : 0);
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
  const baseSha = process.env.EC503_BASE_SHA;
  if (!baseSha || /^0+$/.test(baseSha)) {
    console.log('EC-503: no usable base commit — skipping.');
    return;
  }

  const changed = changedLineCount(baseSha);
  if (changed <= DIFF_CEILING_LINES) {
    console.log(`EC-503: ${changed} changed lines, at or under the ${DIFF_CEILING_LINES}-line ceiling.`);
    return;
  }

  if (hasOverrideLabel()) {
    console.log(
      `EC-503: ${changed} changed lines exceeds the ${DIFF_CEILING_LINES}-line ceiling, ` +
        `but '${OVERRIDE_LABEL}' is present — reviewer has explicitly accepted this as one unit.`,
    );
    return;
  }

  console.error(
    `EC-503: ${changed} changed lines exceeds the ${DIFF_CEILING_LINES}-line ceiling ` +
      `(a placeholder figure — see CLAUDE.md's CI gates table).\n` +
      `Split this PR into reviewable pieces, or add the '${OVERRIDE_LABEL}' label if a reviewer has ` +
      `explicitly agreed this is genuinely one cohesive unit.`,
  );
  process.exitCode = 1;
}

main();
