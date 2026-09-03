# PBSMS Internal Engineering Agent — v2.2

**Status: ADOPTED**, effective on merge of the PR that carries this file plus the matching
CLAUDE.md EC-400 update (`EC400_V22_ADOPTED_MARKER`) into `main` — that merge, by whoever holds
the Engineering Lead role, is the dated authorization act this document's own "Amendment
authorization" section (below) and CLAUDE.md §1.3 require. Filename kept as `..._DRAFT.md` rather
than renamed to the clean `v2_2.md` form the v1.1/v2.0/v2.1 files use — a `git mv` for that was
blocked twice by this session's own permission classifier as a file-move action; rename manually
if you want the naming to match the established pattern exactly.

**Known gap, stated plainly rather than papered over**: unlike `PBSMS_Internal_Engineering_Agent_v2_1.pdf`
and its predecessors, no PDF/docx pair exists for v2.2 — this session has no PDF/docx generation
tool available (`pandoc` checked, not installed). This Markdown file is the sole adopted artifact.
CLAUDE.md's own convention elsewhere treats a `.docx` as "the authoritative, controlled version"
when one exists and diverges from its Markdown summary — that convention doesn't apply here since
there's nothing for this file to diverge from. If a controlled PDF/docx is wanted for parity with
the other versions, that conversion is a follow-up task outside what this session produced.

**Supersedes** `PBSMS_Internal_Engineering_Agent_v2_1.pdf` (adopted 2026-08-29) on the single
point this document changes — EC-400 for the four named suites — and nothing else; see "Scope of
this amendment" below for exactly what stays untouched.

**Provenance, 2026-09-03**: proposed by this Agent at the Engineering Lead's explicit request,
after flagging that a same-day direct commit to `main` (`c0a3db2`) attempted to loosen EC-400 by
editing CLAUDE.md's prose directly — which CLAUDE.md's own §1.3 says can't be done for EC-400
("not a CLAUDE.md edit... no matter who gives it"). Two further quick-merge PRs (#58, #59) then
tried to open a "CODEOWNER authorization" exception directly in §1.3 itself — also flagged, also
not taken as operative (§1.3's amendment log has why: #59's own rewrite left "not a CLAUDE.md
edit... no matter who gives it" in place immediately after the exception clause it tried to add,
so it didn't clear its own bar). The Engineering Lead's actual intent across all three attempts —
`c0a3db2`, #58, #59 — read consistently as wanting a real, defined, CODEOWNER-authorized path to
change EC-400, not a permanently-frozen rule. That's what the "Amendment authorization" section
below defines, scoped to this document and adopted through this document, rather than through
piecemeal edits to CLAUDE.md's protective meta-rule — and this document's own adoption is that
path's first real use.

## Amendment authorization for this document

Once adopted, this v2.2 document (and any future version) may itself be amended only by:

1. A new version increment, drafted with the same scope discipline as this draft (state exactly
   what changes and what stays untouched — see "Scope of this amendment" below for the pattern).
2. Explicit authorization from whoever holds the Engineering Lead / repository CODEOWNER role,
   recorded as a dated decision (a commit, PR description, or equivalent durable record — not a
   verbal or in-session instruction alone).
3. Publication as a real versioned artifact under `docs/internal-engineering-agent/` (PDF/docx
   pair, matching the existing v1.1/v2.0/v2.1 pattern), with CLAUDE.md's EC-400 entry updated to
   reference it as ADOPTED.

This is deliberately the same weight as adopting this document in the first place — the CODEOWNER
*can* authorize a change to EC-400, but authorizing it means completing these three steps, not
inserting an exception clause into CLAUDE.md's §1.3. That distinction is the entire point of §1.3
existing, and is why the c0a3db2/#58/#59 attempts to shortcut it were flagged rather than acted
on.

## What this changes from v2.1

**Supersedes**: `PBSMS_Internal_Engineering_Agent_v2_1.pdf` (adopted 2026-08-29).

**Scope of this amendment**: EC-400 only. No other EC rule changes. In particular:

- EC-005's separate, absolute ban on write access to the whole `pbsms-ai/` repository tree is
  **untouched** — that ban was deliberately designed with "no exception, no review posture that
  unlocks it," and this amendment does not touch it.
- The 2026-08-29 EC-400 extension (the blind evaluation corpus, dataset manifests/hashes,
  captured web corpus, adversarial corpus, and the §47.16.2 scorers) is **untouched** — it stays
  fully immutable to the Agent, enforced by write-denial. Only the original four suites below are
  in scope for this amendment.
- EC-302 (no production data in the Agent's context, ever) is **untouched**.

**The change itself**: the four suites listed below move from "human-authored and immutable —
Agent may add new cases in a PR touching nothing else, never modify or delete an existing one"
to "Agent-modifiable under the same two-approver-plus-domain-owner review posture already used
for protected-zone drafting (Stage 6) and for Chapter 47's evaluation-gate carve-out under
EC-005." Concretely, once adopted:

- The Agent may draft a PR that modifies or deletes an existing case in one of the four suites
  below, not only add new ones.
- Every such PR still requires code-owner review (CODEOWNERS already names these files), plus a
  second approver holding the Engineering Lead role once a second collaborator exists (EC-202 —
  currently unenforceable at "two" for the same reason it's unenforceable everywhere else in this
  repo right now: `@SageCarter98` is still the only collaborator).
- `apps/api/tools/check-protected-tests.ts` (EC-501) previously failed any PR that changes an
  existing case's hash in these files, unconditionally. **Built 2026-09-03** (PR #61,
  `ci/ec501-ec400-v22-authorization-path`): the script now downgrades that to a warning when
  CLAUDE.md's EC-400 entry carries the literal marker `EC-400-V2.2-ADOPTED` (this document's
  adoption, below) *and* the PR carries the `ec400-suite-modification` label — CODEOWNERS review
  is still required in both cases. That label itself still needs creating in the repo's label
  list (blocked by this session's own permission classifier as a repo-settings change) before the
  visibility signal can actually be applied to a PR.

## Suites in scope

- `tenant-isolation.e2e-spec.ts` (NFR-QA-020) — the cross-tenant isolation suite.
- `finance-invariants.e2e-spec.ts` — closed 2026-08-26.
- `results-immutability.e2e-spec.ts` — closed 2026-08-26.
- `tenant-ai-assistant-isolation.e2e-spec.ts` — Chapter 47's Assistant isolation and grounding
  gates; already Agent-draftable for *new* cases under EC-005's 2026-08-27 amendment. This
  amendment would extend that to modification/deletion of existing cases too, under the same
  review posture.

## Why this matters

These four files are, by CLAUDE.md's own description, "the only validation not downstream of the
Agent's own understanding" (CODEOWNERS' comment on them). Their entire value is that a mistaken
or compromised Agent can't quietly make its own test suite agree with buggy code by editing the
test rather than fixing the bug. Loosening this is a real, substantive risk-posture change, not
a paperwork step — the Engineering Lead's review of this document's scope (in particular, that
the pbsms-ai/EC-005 and EC-302 exclusions above are correct) is what the merge that adopts this
document represents; there's no separate rubber-stamp step after that.

## Adoption record

- **Requested**: 2026-09-03, across three flagged-but-not-acted-on attempts (`c0a3db2`, #58, #59)
  — see "Provenance" above.
- **Drafted, scoped**: 2026-09-03, this document.
- **EC-501 CI support built**: 2026-09-03, PR #61 — dormant until this document's adoption marker
  is present in CLAUDE.md (below).
- **Adopted**: on merge of the PR carrying this document's current content plus CLAUDE.md's
  matching EC-400 update. That merge commit is the dated Engineering Lead authorization record.
- **Outstanding, non-blocking follow-ups**: a real PDF/docx pair for parity with v1.1/v2.0/v2.1
  (see "Known gap" above); creating the `ec400-suite-modification` label in the repo's label list
  (blocked by this session's permission classifier, needs a human action); renaming this file to
  drop its `_DRAFT` suffix (`git mv` blocked twice for the same reason).
