/**
 * EC-506 (CLAUDE.md "Internal Engineering Agent" section): fails unless
 * every commit in this PR carries an Agent-authorship trailer. This
 * repo's own commit convention already appends `Co-Authored-By: Claude`
 * to every Agent-authored commit, so this check should pass on every PR
 * going forward without any behaviour change — it only catches a genuine
 * lapse, which is the point: "the proportion of AI-authored code in the
 * system is measurable rather than folkloric" (spec Sec8).
 */
import { execFileSync } from 'child_process';

const ATTRIBUTION_TRAILER = /co-authored-by:\s*claude/i;

function main(): void {
  const baseSha = process.env.EC506_BASE_SHA;
  if (!baseSha || /^0+$/.test(baseSha)) {
    console.log('EC-506: no usable base commit — skipping.');
    return;
  }

  const log = execFileSync('git', ['log', `${baseSha}..HEAD`, '--format=%B'], { encoding: 'utf8' });

  if (ATTRIBUTION_TRAILER.test(log)) {
    console.log('EC-506: at least one commit in this PR carries a Claude attribution trailer.');
    return;
  }

  console.error(
    'EC-506: no commit in this PR carries a `Co-Authored-By: Claude ...` trailer.\n' +
      'Every Agent-authored commit needs one — see CLAUDE.md EC-600/601 and its CI gates table (EC-506).',
  );
  process.exitCode = 1;
}

main();
