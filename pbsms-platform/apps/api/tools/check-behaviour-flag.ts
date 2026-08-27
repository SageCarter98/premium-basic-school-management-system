/**
 * EC-505 (CLAUDE.md "Internal Engineering Agent" section): the spec's own
 * wording is "a user-visible workflow change ships without a feature flag
 * (EC-311)" — but detecting "is this a user-visible workflow change" from
 * a diff is a judgement call, not a mechanical fact, and this repo has no
 * feature-flag system yet to detect references to. Rather than fake a
 * semantic check this script can't honestly perform, this is a
 * self-attestation gate: it fails unless the PR body states its feature-
 * flag position explicitly, so a human makes the judgement call visibly
 * instead of the check silently assuming "no flag needed."
 *
 * This is a proxy, not a semantic check — named as one, not overclaimed.
 */
const FLAG_LINE = /^\s*feature flag:\s*\S/im;

function main(): void {
  const body = process.env.PR_BODY ?? '';

  if (!body) {
    console.log('EC-505: no PR_BODY set (not a pull_request event) — skipping.');
    return;
  }

  if (FLAG_LINE.test(body)) {
    console.log('EC-505: PR body states a feature-flag position.');
    return;
  }

  console.error(
    "EC-505: this PR's body has no `Feature flag: <name>` or `Feature flag: N/A — <reason>` line.\n" +
      'State it explicitly, even to say none is needed and why — see CLAUDE.md\'s CI gates table (EC-505).',
  );
  process.exitCode = 1;
}

main();
