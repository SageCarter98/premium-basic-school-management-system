# PBSMS Internal Engineering Agent — v2.2 (DRAFT, NOT ADOPTED)

**Status: proposed amendment, not yet adopted.** This file is a working draft only. It has no
standing under CLAUDE.md's §1.3 until the Engineering Lead adopts it — by replacing this file
with a real versioned PDF/docx pair under `docs/internal-engineering-agent/` (matching the
pattern of `PBSMS_Internal_Engineering_Agent_v2_1.pdf`) and updating CLAUDE.md's EC-400 entry to
point at it as ADOPTED, the same way v2.0 → v2.1 was adopted on 2026-08-29. Until then, EC-400 in
CLAUDE.md remains exactly as written: the four suites below are immutable to the Agent.

Proposed by this Agent on 2026-09-03, at the Engineering Lead's explicit request, after flagging
that a same-day direct commit to `main` (`c0a3db2`) attempted to loosen EC-400 by editing
CLAUDE.md's prose directly — which CLAUDE.md's own §1.3 says can't be done for EC-400 ("not a
CLAUDE.md edit... no matter who gives it"). This draft is the actual re-adoption path.

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
- `apps/api/tools/check-protected-tests.ts` (EC-501) currently fails any PR that changes an
  existing case's hash in these files, unconditionally. **This amendment requires EC-501 to be
  updated** to distinguish an Agent PR that's going through the new review posture from one that
  isn't — until that CI change exists and is deployed, a PR modifying an existing case will still
  be mechanically blocked regardless of what this document says. EC-205 (CI configuration
  changes) governs who may make that CI update and under what review; it does not get a shortcut
  here.

## Suites in scope

- `tenant-isolation.e2e-spec.ts` (NFR-QA-020) — the cross-tenant isolation suite.
- `finance-invariants.e2e-spec.ts` — closed 2026-08-26.
- `results-immutability.e2e-spec.ts` — closed 2026-08-26.
- `tenant-ai-assistant-isolation.e2e-spec.ts` — Chapter 47's Assistant isolation and grounding
  gates; already Agent-draftable for *new* cases under EC-005's 2026-08-27 amendment. This
  amendment would extend that to modification/deletion of existing cases too, under the same
  review posture.

## Why this matters before adopting it

These four files are, by CLAUDE.md's own description, "the only validation not downstream of the
Agent's own understanding" (CODEOWNERS' comment on them). Their entire value is that a mistaken
or compromised Agent can't quietly make its own test suite agree with buggy code by editing the
test rather than fixing the bug. Loosening this is a real, substantive risk-posture change, not
a paperwork step — worth the Engineering Lead reviewing this draft's scope carefully (in
particular, confirming the EC-501 update requirement above isn't skipped) before adopting it,
rather than adopting on the strength of the request alone.

## Adoption checklist (for the Engineering Lead)

1. Review this draft's scope — confirm the pbsms-ai/EC-005 and EC-302 exclusions above are
   correct and intended.
2. If accepted: convert to a versioned PDF/docx pair (`PBSMS_Internal_Engineering_Agent_v2_2.pdf`
   /`.docx`), update CLAUDE.md's EC-400 entry to reference it as ADOPTED (mirroring how v2.1 is
   referenced today), and update `docs/internal-engineering-agent/`'s directory listing in
   CLAUDE.md's "Repository state" section.
3. Before any Agent PR actually modifies an existing case in one of the four suites: update
   `apps/api/tools/check-protected-tests.ts` (EC-501) to permit that specific, reviewed pattern —
   see "The change itself" above. This is a CI-configuration change under EC-205, itself now
   mergeable by the Agent once code-owner-approved per EC-200/EC-205's 2026-09-03 amendment.
4. Delete this draft file once real adoption artifacts exist, same as prior superseded drafts are
   kept only in their final adopted form.
