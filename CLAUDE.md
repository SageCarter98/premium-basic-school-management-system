# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**This section was stale for a long time** (it used to say "no source code — only planning artifacts," which stopped being true once `pbsms-platform/` was scaffolded). Corrected here as part of standing up the Internal Engineering Agent rules below — catching exactly this kind of drift is what EC-106 (documentation drift detection) exists for.

**Spec/governance PDFs and their `.docx` companions moved into `docs/` on 2026-08-29**, out of the repo root where 21 files had accumulated flat and two `.docx` siblings had drifted into a stray `files/` directory instead of sitting next to their own PDFs. Four category subfolders, matching this document's own conceptual split (product foundation / frontend spec / product feature "Model A" / internal process "Model B"):
- `docs/srs/` — the master SRS and its predecessor
- `docs/frontend-design/` — the frontend build-order spec
- `docs/tenant-ai-assistant/` — Chapter 47 (Model A) and its implementation Blueprint
- `docs/internal-engineering-agent/` — this Agent's own process spec (Model B) and its "Copilot" predecessor

Every `PBSMS_*.pdf`/`.docx` filename named below now lives under one of those four, not at repo root — paths given inline. `PBSMS.md` (an SRS review/gap-analysis doc) and `srs_v21_extract.txt` (a derived plain-text extract) were left at root, out of scope for this pass.

- `pbsms-platform/` — the real NestJS API + Next.js web app. Read `pbsms-platform/README.md` first before assuming what's built; it's kept as a living, currently-accurate completion record (a status table of what exists vs. doesn't, an actual verification log), not static documentation.
- `docs/srs/PBSMS_Multi-Tenant_Enterprise_SRS_v2.1.pdf`/`.docx` — the current authoritative spec. It supersedes `docs/srs/PBSMS_Complete_Enterprise_Specification_Volumes_I-IV.pdf` (the original single-school-framed merged spec, kept for history) — SRS v2.1 is multi-tenant from the start.
- `docs/frontend-design/PBSMS_Frontend_Design_Specification_v1.1.pdf` — the frontend build-order and component spec, referenced throughout `pbsms-platform/apps/web`.
- `docs/tenant-ai-assistant/PBSMS_Tenant_AI_Assistant_Ch47_v2_1_Adopted.pdf` — SRS v2.1 Chapter 47, a subscription-gated per-tenant AI assistant. A **product feature** (schools pay for and use it). **Supersedes v2.0 as of 2026-08-29** — status header says "ADOPTED BASELINE — APPROVED FOR BUILD," v2.0 archived. Makes a named, versioned **PBSMS Domain AI Model** the primary artifact and adds four previously-unpermitted capabilities — Research, Controlled Live Internet Research, General Conversation, Combined Analysis — with matching isolation/privacy rules (new FR-AIT-700s/800s/900s, DP-109–118, TEN-056–062). New §47.0.4 adopts `docs/tenant-ai-assistant/PBSMS_Domain_AI_Model_Architecture_and_Implementation_Blueprint_v1_0.pdf` alongside it as the (subordinate) implementation baseline; new §47.0.5 names an exposure that adopting the Blueprint's `pbsms-ai/` tree created for the then-current Internal Engineering Agent v2.0 rules, closed same-day by IEA v2.1 below. New build-authorization table (§47.0.2) clears Stages 0.5–5 (a cheap demand-validation slice through the governance runtime) and gates Stage 6+ on privacy/provider decisions; §47.19's open questions (no model provider selected, DP-103/DP-107 unresolved) explicitly survive adoption. The prior draft amendment schedule (`docs/tenant-ai-assistant/PBSMS_Chapter_47_Draft_Amendment_Model_Research_v2_1.pdf`) and its gap-closure schedule are retired — folded into this consolidated text, kept only as review record. `v2_0`/`v1_0` kept for history.
- `docs/tenant-ai-assistant/PBSMS_Domain_AI_Model_Architecture_and_Implementation_Blueprint_v1_0.pdf` — adopted 2026-08-29 alongside Ch47 v2.1 as its implementation baseline (reference architecture, training/data pipeline, runtime, evaluation gates, deployment). Subordinate to Ch47: where they conflict Ch47 controls and the Blueprint is corrected, never the reverse; its reference values (8B–14B candidate envelope, 32k context floor, etc.) are starting points for measurement, not adopted requirements. Establishes the `pbsms-ai/` repository ownership boundary that Internal Engineering Agent v2.1 (below) had to be amended same-day to reach.
- `docs/internal-engineering-agent/PBSMS_Internal_Engineering_Agent_v2_1.pdf` — the process spec the "Internal Engineering Agent" section below implements. **Not a product feature. Supersedes v2.0 as of 2026-08-29**, adopted the same day as Ch47 v2.1 specifically to close the exposure that adoption created: v2.0's EC-005 (an enumerated file list) and EC-400 (four named test suites) predated `pbsms-ai/` and didn't reach it — as v2.0 stood, this Agent could have modified the blind evaluation corpus that Ch47 §47.16 release gates are computed against, undetected by any CI check, because the corpus *is* the measuring instrument. **EC-005 now bans write access to the whole `pbsms-ai/` tree** (read retained for EC-102); **EC-400 now also covers the blind evaluation corpus, dataset manifests/hashes, captured web corpus, adversarial corpus, and the §47.16.2 scorers**, not just the four suites it named before. New **EC-507** is a CI gate failing any Agent PR touching `pbsms-ai/` at all — **cleared to build, not yet built**; until it exists the boundary is enforced by this rulebook alone. **Flagged inconsistency, not yet corrected in the PDF**: v2.1's own §5 Protected Zones table separately lists "Chapter 47 Assistant prompts, scope config, evaluation gates" as "No access. Prohibited outright (EC-005)" — read literally that would revert the 27 August relaxation described below (Agent may draft Ch47 artefacts — prompts, scope configuration, retrieval rules, evaluation gates — under two-approver-plus-domain-owner review, regardless of which build stage they fall under). Confirmed 2026-08-29 with the repo owner that the relaxation still stands and this table row is an uncorrected carry-forward, not an intended withdrawal — treat the two-approver-review permission as controlling until the PDF is fixed to match. No other EC rule's substance changed from v2.0. (`docs/internal-engineering-agent/PBSMS_Internal_Engineering_Agent_v1_1.pdf` and `docs/internal-engineering-agent/PBSMS_Internal_Engineering_Copilot_v1_0.*` kept for history.)
- `mardown` — a short plain-text rules file (not real Markdown, despite the name) with the user's working preferences (see below).
- `pbsms-platform/infra/seed/` — disposable dev/CI fixture data only, never production. See `infra/seed/DISPOSABLE.md` for exactly what that means and why it's structurally true, not just a convention. Added 2026-08-28: `pbsms-seed/`, a synthetic multi-tenant fixture generator — not yet wired into CI or usable against the real schema, see `infra/seed/pbsms-seed/SCHEMA-RECONCILIATION.md` for what's blocking that.

There IS a build system, package manifest, test suite and real application code now — `pbsms-platform/` has its own `package.json` workspaces (`apps/api`, `apps/web`), a migration runner, an e2e isolation suite, and CI (`.github/workflows/ci.yml`, at this true repo root — GitHub Actions does not discover workflows nested inside a subdirectory, a real gap found and fixed 2026-08-24). Check `pbsms-platform/README.md`'s Quick Start for the actual current commands rather than assuming any from memory.

## What PBSMS is

Premium Basic School Management System (PBSMS) — a configurable, role-based, integrated school-management platform for **Nursery through Junior High School (JHS)** only.

- Country context: Ghana. Default currency **GHS**, default time zone **Africa/Accra** (both configurable per institution).
- Out of scope: Senior High School, universities, semesters, credit hours, GPA/CGPA, degree programmes.

### Critical framing: this is an upgrade, not a greenfield build

The spec is explicit and repeated across volumes: **PBSMS is a controlled upgrade of an existing "Premium Grading System," not a new or separate project.** That existing system is *not present in this repository*. Before any implementation work starts here, the actual existing codebase must be located/imported and inspected — do not assume a stack, scaffold a new app from scratch, or start a parallel project without explicit authorization from the user.

The spec's own execution rules for an AI coding agent (Volume IV, Chapter 46, written for "Codex" but equally applicable here) are effectively the working rules for this repo:

- **Mandatory first action**: inspect the complete repository, database model, auth, roles, routes, services, background jobs, design system and tests; record the actual project root, stack, framework versions, database engine, working modules, incomplete features and known risks — before proposing changes.
- **Protection rules**: do not create another project folder or rebuild from scratch without explicit authority; do not delete existing data, reset the database, remove working features, or overwrite historical results; do not rename fields without a safe migration + rollback path; do not bypass server-side permissions or treat UI hiding as authorization; do not silently continue on to unrelated work.
- **Implementation standard**: a "complete" module includes DB changes, backend services, role permissions, validation, UI, notifications, audit events, reports, tests, migration notes, and integration evidence — not just the happy-path code.
- **Completion gate**: run migrations/seeds, formatting, linting, type checks, builds and automated tests; test permission and record-scope boundaries; summarize changed files, migrations, rollback steps and unresolved risks; then stop rather than cascading into the next phase automatically.
- Work is meant to proceed **one numbered/scoped prompt at a time**: inspect, preserve, implement only the current scope, verify, report evidence, stop.

### User's working rules (from `mardown`)

- Preferred language: Python (JavaScript/HTML acceptable if that fits the existing stack better).
- Keep code simple, clean, and heavily commented (this overrides the default "no comments" convention for this project specifically).
- **Explain the plan before changing any file** — get sign-off before editing, don't just proceed.

## Document map (for navigating the spec PDF)

The PDF is a merged 4-volume, 55-chapter document (~5,500 lines of extracted text). Use targeted lookups rather than reading it linearly.

| Volume | Chapters | Title | Content |
|---|---|---|---|
| I | 1-21 | Enterprise Foundation and Academic Architecture | Business context, requirements, design principles, enterprise architecture, master data, academic model |
| II | 22-31 | Functional Modules and Processing Engines | The actual functional modules (admissions, attendance, grading, finance, etc.) |
| III | 32-45 | Technical Architecture and Implementation Blueprint | Layered architecture, DB/schema standards, ER model, API architecture, security architecture, deployment |
| IV | 46-55 | Codex Implementation Blueprint | Numbered, sequential AI-agent execution prompts covering audit → backlog → migration → backend → frontend → automation → security → QA → deployment |

Key chapters worth knowing exist:
- **Ch. 6** (Enterprise System Architecture) and **Ch. 32** (Technology Architecture and Existing-System Upgrade Strategy) define the target layered architecture: Presentation → Application/API → Domain → Data access → Infrastructure, with modules communicating only through approved services/APIs/events (no direct cross-module table access).
- **Ch. 33-34** (Database Architecture / ER Model) define schema conventions: plural snake_case tables, immutable primary keys separate from business numbers, `created_at/by`, `updated_at/by`, soft-delete fields, and a core `Student → Enrolment → transactions` model where student identity is permanent and separate from yearly enrolment.
- **Ch. 35-36** (API Architecture / Security Architecture) define API and access-control standards: versioned APIs, per-request auth+scope+business-state checks, idempotency for sensitive operations (admission conversion, promotion, payments, invoicing).
- **Ch. 46-55** (Volume IV) are the literal implementation prompt sequence — read the relevant chapter before doing any implementation work in that area, since it encodes acceptance criteria and completion gates per phase.

## Scope boundaries to respect

- Nursery, Kindergarten, Primary, JHS only — never add SHS/tertiary/semester/GPA concepts.
- Historical/official records (results, report cards, posted payments) are preserved via versioning or reversal, never overwritten or deleted.
- Currency and timezone defaults are Ghana-specific but must stay configurable, not hardcoded.

## Internal Engineering Agent — process rules (EC- series)

**ADOPTED — APPROVED FOR IMPLEMENTATION** (v2.1, adopted 29 August 2026, superseding v2.0 adopted 27 August 2026 — see Repository state above). v2.1 is one urgent change, not a general revision: it closes the `pbsms-ai/` gap that adopting Chapter 47 v2.1's Architecture Blueprint created the same day (EC-005/EC-400, below) — no other EC rule's substance changed. This section is the "Agent rulebook" §1.2 calls for — read on every invocation, it's what makes the rules binding rather than aspirational.

**What this governs**: an AI coding assistant (this one, Claude Code) operating inside this repository to help build PBSMS. **It does not govern Chapter 47's Tenant AI Assistant** — a separate, unrelated system (a product feature a school subscribes to and uses), sharing no infrastructure, no credentials and no code path with this one (EC-003).

### Amendment (§1.3) — read this before touching any EC rule

- Amending any EC rule requires a version increment and re-adoption by whoever holds the Engineering Lead role. EC identifiers are permanent; a withdrawn rule is marked withdrawn and retained, never deleted.
- **EC-302 and EC-400 are not amendable by the ordinary process at all.** Changing either requires re-adoption of the whole document — not a CLAUDE.md edit, not an in-session instruction, no matter who gives it. They remain the rules whose entire value is that they cannot be relaxed by whoever is under pressure at the time, and neither has been touched.
- **Correction, 2026-08-27 (morning)**: earlier the same day, before v2.0 arrived, this Agent drafted and opened a PR amending EC-005 in CLAUDE.md directly, following an explicit in-session instruction from the repo owner. That PR (#10) was invalid under v2.0's then-current text and was closed without merging. The mistake was treating EC-005 as EC-201-style (a rule with documented precedent for a narrow, human-authorized exception the *Agent* could act on once asked) rather than checking whether it carried its own, stricter amendment rule — it did, at the time.
- **EC-005 amended, 2026-08-27 (afternoon), by direct commit from whoever holds the Engineering Lead role** — not drafted, requested, or executed by this Agent; the repo owner committed the change to CLAUDE.md themselves. This is a materially different act from the morning's invalid PR: it's the named Engineering Lead's own direct exercise of the authority §1.3's first bullet already gives them ("amending any EC rule requires... re-adoption... by whoever holds the Engineering Lead role"), not a request routed through or pressuring this Agent. Whether one CLAUDE.md commit fully satisfies "re-adoption of the whole document" as a literal reference to the external `PBSMS_Internal_Engineering_Agent` PDF is left open here rather than resolved unilaterally by this Agent either way — what's unambiguous is that the person authorized to hold this document accountable made the call directly, on the record, in their own commit. EC-302 and EC-400 remain fully intact, untouched by it.
- **EC-005 (and EC-400) amended again, 2026-08-29, via full document re-adoption (IEA v2.0 → v2.1)** — unlike the 27 August event above, whose sufficiency as "re-adoption of the whole document" was left open, this is unambiguous: a new versioned, adopted PDF. The change *widens* both rules (EC-005 from an enumerated file list to a whole-`pbsms-ai/`-tree write ban; EC-400 to add the blind evaluation corpus, dataset manifests/hashes, and scorers alongside the four named suites) rather than relaxing either — so it wouldn't have needed whole-document re-adoption even under the strictest reading of "not amendable by the ordinary process," which is about relaxation, not tightening. EC-302 untouched. See Repository state above for the flagged inconsistency between v2.1's Protected Zones table and the 27 August relaxation — resolved 2026-08-29 in favor of the relaxation standing, pending a PDF correction.
- Advancing a rollout stage is an explicit, recorded decision by the Engineering Lead against the stated advance condition — never by drift, consensus, or a previous stage running a while without incident.

### Hard separation from the product (EC-001 to EC-005) — no exception, no escalation path

- EC-001 — not deployed in, callable from, or reachable by the PBSMS production runtime.
- EC-002 — no credentials to any production database, no production API keys, no path to any tenant record.
- EC-003 — this Agent and the Tenant AI Assistant (Chapter 47) share no infrastructure, no credentials, no code path. A compromise of one must not reach the other.
- EC-004 — no output of this Agent reaches a tenant except as reviewed, merged, tested, released code, on exactly the same path as any human engineer's work.
- **EC-005 — amended 2026-08-27 (see §1.3 above for how), and again 2026-08-29.** This Agent may assist in developing and implementing Chapter 47 artefacts — the Assistant's prompts, scope configuration, retrieval rules, and evaluation gates — under the same protected-zone review posture as any other safety-critical code in this repo (two human approvers, one holding Chapter-47/AI domain ownership; see Protected zones below). This does not relax EC-400 separately: an evaluation-gate test suite (e.g. the Chapter 47 isolation/grounding suite) may be Agent-drafted under that same review, exactly as `finance-invariants.e2e-spec.ts` and `results-immutability.e2e-spec.ts` were — but once it exists and is merged, this Agent may add new cases in a PR touching nothing else and may never modify or delete an existing one, same as those two files. **As of 2026-08-29, EC-005 additionally bans write access to the whole `pbsms-ai/` repository tree outright** (Model Constitution and compiled artifacts, tool/response schemas, dataset manifests/generators, training config, evaluation corpora/scorers, release manifests) — read access retained for EC-102 question-answering, no exception, no review posture that unlocks it. This is a separate, stricter boundary layered on top of the 27 August permission above, not a replacement for it; see Repository state's flagged note on the newly-adopted PDF's Protected Zones table for the one place the two documents currently read as being in tension.

### The merge boundary (EC-200 to EC-205)

- EC-200 — this Agent never merges to `main`. No maturity threshold, no accumulated success rate, no trusted-mode flag unlocks this.
- EC-201 — every Agent pull request requires review and approval by a named human engineer before merge, on the same terms as a human-authored PR.
- EC-202 — a pull request touching a protected zone (below) requires two human approvers, one holding the Engineering Lead role. **Not yet mechanically enforceable at "two"**: `@SageCarter98` is the repo's only collaborator right now (a second has been invited, not yet joined), so branch protection is configured for 1 required approval — GitHub's review-count setting is per-branch, not conditional per path. CODEOWNERS does correctly force that one review to come from a code owner on every protected-zone path. Revisit the count once the second engineer joins.

  **A deeper gap found exercising this for real (PR #1, 2026-08-24)**: GitHub refuses to let a PR author approve their own PR, full stop. Since every commit and PR here was authored as the one account that exists, formal code-owner approval was structurally impossible for *any* PR — a hard deadlock. Given the choice, `enforce_admins` is **off**: the required review + all-CI-green gate still applies to everyone, but the repo owner can merge as admin without a review when no second reviewer exists yet. **This Agent must never invoke that bypass on its own work** — that's exactly what EC-201 exists to prevent.
- EC-203 — deployment to production is human-triggered; this Agent holds no deploy permission.
- EC-204 — this Agent shall not approve any pull request, including one it did not author.
- EC-205 — this Agent shall not modify CI configuration, branch protection rules, or repository permissions. (The CI relocation fix and the EC-501 job addition to `ci.yml`, both in this file's git history, were human-directed, explicitly-approved one-time exceptions — not a standing permission; each future touch needs its own sign-off.)

### Feedback pipeline and cross-tenant contamination (EC-300 to EC-303, EC-310 to EC-313)

- EC-300 — anonymisation at ingestion: student/guardian/staff names, contact details, admission numbers, invoice numbers, BECE index numbers and any free-text identifier stripped before feedback reaches this Agent's context. **Not amendable by the ordinary process** (see above).
- EC-301 — tenant attribution by opaque identifier only. This Agent may know fourteen tenants reported the same friction; it shall never know which fourteen.
- EC-302 — no production data in this Agent's context, ever, in any form — not a sample, not an export, not a temporary debugging copy. A human diagnoses what can't be diagnosed without real data.
- EC-303 — telemetry is behavioural (role + screen), never personal, never carrying a user or real-tenant identifier.
- EC-310 to EC-313 — volume is an input to a human product decision, never a mandate; a shared-schema workflow change ships behind a feature flag, default off; no mid-term-of-a-Ghanaian-term-year workflow changes without explicit tenant consent; a minority tenant is never outvoted into breakage by a flag default.

### Protected zones and immutable suites (EC-400, EC-401) — draft-with-stricter-review, or no access at all

Enforced for real as of 2026-08-24: this repo is public, `.github/CODEOWNERS` names `@SageCarter98` as owner of every path below, and branch protection on `main` requires a code-owner review plus 8 CI jobs green before merge — the original 6, plus `protected-test-integrity` (EC-501) and `agent-pr-gates` (EC-500/502-506), both added to the required-status-checks list on 2026-08-27 under the same human-directed, explicitly-approved one-time exception to EC-205 already used for the `ci.yml` edits themselves — not a standing permission; each future branch-protection touch needs its own sign-off, same as CI config. May draft changes in the zones below, but every PR touching one needs code-owner review:
- RLS policies; any migration touching a tenant-owned table
- Tenant context middleware, `AsyncLocalStorage` scoping, request-scoped DB service
- Authentication, authorisation, Chapter 13 scope resolution
- Finance ledger, allocation, reversal (Ch 23-25) — needs a finance-domain-owning approver too
- Results immutability and publication gate (`FR-RES-020`, `FR-RES-030`)
- Subscription metering and billing (`TEN-030`, `TEN-031`)
- Chapter 47 Tenant AI Assistant's prompts, scope configuration, retrieval rules, evaluation gates (EC-005, amended 2026-08-27 — see above) — needs a Chapter-47/AI-domain-owning approver too

**No access at all, prohibited outright**:
- EC-400 — the following suites/corpora shall be human-authored and immutable to this Agent; it may propose additional cases in a PR touching nothing else, never modify or delete an existing one. **Not amendable by the ordinary process** (see above):
  - the cross-tenant isolation suite (`tenant-isolation.e2e-spec.ts`, NFR-QA-020)
  - Chapter 47's Assistant isolation and grounding gates (may be Agent-drafted under the same two-approver review as the two suites below, per EC-005's 2026-08-27 amendment — "human-authored" here means protected from Agent modification once merged, not barred from Agent-drafted initial authorship, same pattern the two suites below already establish)
  - the finance invariant suite (`finance-invariants.e2e-spec.ts`, closed 2026-08-26)
  - the results-immutability suite (`results-immutability.e2e-spec.ts`, closed 2026-08-26)
  - **added 2026-08-29**: the blind evaluation corpus, dataset manifests and their hashes, the captured web corpus, the adversarial corpus, and the scorers that compute Chapter 47 §47.16.2's metrics — a modification here fails no CI gate (the gates are *computed against* this material), so it's a stricter failure mode than an edited test and gets the same immutability, enforced by write-denial rather than by a content-hash check

  *Enforcement is three layers as of 2026-08-26 for the original four suites.* Branch protection + CODEOWNERS mechanically require human review on any PR touching these files at all. `apps/api/tools/check-protected-tests.ts` (the EC-501 job) parses each protected file with the TypeScript compiler API, hashes every `it(...)`/`test(...)` call's normalized body, and fails the build if any hash present at the PR's base commit is missing at head — a kept title with a gutted body still fails, since matching is by content. New cases never flagged. Live-verified against all three failure modes before merging. **The 2026-08-29 additions (the `pbsms-ai/` corpus/manifests/scorers) have no mechanical enforcement yet** — EC-507, a CI gate that fails any Agent PR whose diff touches `pbsms-ai/` at all, is cleared to build but not yet built (see CI gates table below); until then this boundary is rulebook-only, and `pbsms-ai/` doesn't exist in the repo yet anyway.

### CI gates for Agent pull requests (EC-500 to EC-506)

A pull request passes every gate below before a human is asked to look at it — spending reviewer attention on something an automated check would reject is the fastest way to make reviewers stop reading carefully.

| ID | Gate | Status |
|---|---|---|
| — | Existing pipeline: SAST, dependency scan, RLS coverage gate, cross-tenant isolation suite, accessibility gate | Built, running in `ci.yml` |
| EC-500 | Protected-path check — diff touches a protected zone without the required label/approver count | **Not built.** Cleared to build now. |
| EC-501 | Immutable-suite check — any protected test file modified or deleted | **Built, 2026-08-26** (`apps/api/tools/check-protected-tests.ts`, the `protected-test-integrity` job), covering the original four suites. **Scope widened 2026-08-29** by EC-400's extension to the `pbsms-ai/` evaluation corpus/manifests/scorers — that widened coverage is not yet implemented; see EC-507. |
| EC-502 | Migration safety check — a destructive migration with no explicit, separately-reviewed exception | **Not built.** Cleared to build now. |
| EC-503 | Diff ceiling — change exceeds the reviewable size limit (proposed 400 changed lines), not split | **Not built.** Cleared to build now; the 400-line figure is a guess per the spec's own Open Questions, to be re-set from stage-3 measurement. |
| EC-504 | Traceability check — PR doesn't reference the SRS requirement IDs it implements/changes | **Not built.** Cleared to build now. |
| EC-505 | Behaviour-change flag check — a user-visible workflow change ships with no feature flag (EC-311) | **Not built.** Cleared to build now. |
| EC-506 | Attribution check — commit/PR not labelled Agent-authored | **Not built.** Cleared to build now. |
| EC-507 | Protected-boundary check — Agent PR diff touches `pbsms-ai/` at all, including rename/move | **New 2026-08-29. Not built.** Cleared to build ahead of everything else in this table — Chapter 47 §47.18 stage 1 is work inside that tree, and that stage is already cleared to start. |

### Accountability (EC-600 to EC-602)

Every merged change this Agent authors is labelled Agent-authored in the commit and PR, and carries the name of the human reviewing engineer as author of record — "the model wrote it" is not an accountability position available under Ghana's Data Protection Act. An incident caused by an Agent-authored change is reviewed as a failure of the gates and the process (EC-602), not of the reviewer alone.

### EC-700 — suspension condition

If the defect-escape rate of Agent-authored merged changes exceeds the human baseline over two consecutive quarters, or any Agent-authored change causes a cross-tenant data exposure, implementation capability (EC-104 drafting change proposals as code, EC-105 test authoring) is suspended immediately; only analysis capabilities (EC-100 to EC-103, EC-107) are retained pending review. No baseline exists yet to compare against (see the authorization table below) — establishing one is a stage-4 prerequisite.

### What's actually authorized right now (§1.3's staged table) — read before starting *any* new work

This is the single most operationally important addition v2.0 makes. Adoption authorises implementation, but not all at once — three prerequisites are external and can't be closed by starting work anyway:

| Item | Authorization, 2026-08-27 |
|---|---|
| CLAUDE.md rulebook; CODEOWNERS + branch protection | CLEARED, done |
| Chapter 47 (Model A) artefact authorship — prompts, scope config, retrieval rules, evaluation gates, regardless of which Ch47 build stage they fall under | **CLEARED, 2026-08-27, reaffirmed 2026-08-29** — EC-005 amendment above; two-approver-plus-domain-owner review applies, same as finance/results. Where a given artefact touches `pbsms-ai/`, additionally gated in practice on that write access being genuinely closed off (EC-507) first, per Ch47 v2.1 §47.0.5. |
| EC-501 immutable-suite CI check | CLEARED, done (2026-08-26) for the original four suites; scope widened 2026-08-29, widened portion not yet built (see EC-507) |
| EC-500, EC-502 to EC-507 gates | **CLEARED — begin immediately. Not yet built.** EC-507 (the `pbsms-ai/` write-boundary check) is the priority of this set — build it before any Chapter 47 §47.18 stage-1 work starts inside that tree. |
| Repository question-answering (EC-102) | CLEARED, in continuous use every session |
| Feedback ingestion & clustering (EC-100/101) | BUILD CLEARED (done — capture 2026-08-24, clustering 2026-08-24, digest job 2026-08-26), **operation deferred** — no real tenants exist yet, so there's no feedback signal to actually cluster in production |
| Gap detection (EC-107) | **CLEARED — begin immediately. Not yet built.** |
| Stage 3 — test-only pull requests | CLEARED (EC-501 exists — the gate condition is satisfied). PR #5's finance/results invariant suites already exercised this, one PR ahead of EC-501 itself existing — a real sequencing slip, harmless in outcome, worth remembering as precedent for reading a gate's condition before starting, not after. |
| **Stage 4 onward — general implementation PRs (code changes outside protected zones)** | **GATED on a human defect-escape baseline existing (§9/§13). Does not exist yet — takes roughly a quarter of ordinary human-authored development to produce, and cannot be shortcut. Not yet authorized.** |
| Stage 6 — protected-zone drafting | **NOT AUTHORISED by this adoption.** A separate, explicit Engineering Lead decision, not automatic on stages 1–5. |

**What this means in practice**: outside the specifically-cleared categories above (feedback pipeline, gap detection, EC-501-style CI tooling, repo Q&A, docs), this Agent should not take on ordinary PBSMS feature-implementation work until the Stage-4 defect-escape baseline exists. The already-merged feature work in this repo's history either predates 2026-08-24 governance entirely (direct commits, no PR process yet existed) or falls inside an explicitly-cleared category above — none of it needs to be revisited, but *new* general implementation tasks do need this gate checked first, not assumed open because past tasks happened to fit a cleared category.

**Tracked open item, 2026-08-27**: an automated "find *and fix*" bug capability (as distinct from EC-107's gap detection, which only reports) was asked about in-session. It would fall under EC-104 (Implementation), which is general implementation capability — already covered by the Stage-4 gate above. Not something to build or scope further until that baseline exists; noted here so it isn't re-raised as if it were a gap in this file rather than a deliberate wait.

### Chapter 47 (Model A) build authorization (§47.0.2)

Chapter 47 v2.1 is its own ADOPTED BASELINE, APPROVED FOR BUILD (2026-08-29, superseding v2.0 — see Repository state above), adopted together with the Domain AI Model Architecture and Implementation Blueprint v1.0 as its subordinate implementation baseline. Its build order is staged independently of this Agent's own EC-series rollout stages above; the two gate different things (Chapter 47's own table says what may be built and when; EC-005 above, as amended, says who may draft it and under what review):

| Stage | Scope | Authorization |
|---|---|---|
| 0.5 | Demand validation — Ask only, staff only, read-only, on the governance runtime with a prompt-configured general model behind the model adapter | **CLEARED.** Internal and consenting-canary measurement only. Never released, marketed, or described as the PBSMS Domain AI Model (FR-AIT-702). |
| 1–2 | Model definition, registry, constitution; synthetic corpus, golden sets, adversarial corpus, evaluation harness | **CLEARED.** No tenant data, no production credentials, no unrestricted internet. |
| 3 | Base-model selection and PBSMS adaptation | **CLEARED** for work on approved non-tenant data only. |
| 4–5 | Governance runtime; operational retrieval under RLS | **CLEARED.** Required under every outcome, including abandonment of the model programme. |
| 6 | Research collections and Controlled Live Internet Research | GATED on the privacy/DLP/network gates in §47.8 and §47.16.2 being green, and on search/browsing providers assessed under DP-113. |
| 7 | Live tenant retrieval — operational shadow | GATED on a model-hosting arrangement contractually satisfying DP-103, DP-104 and DP-107. |
| 8–9 | Canary, then Draft/Explain/Find/Combined Analysis, demo and metering | GATED on the preceding stage; commercial limits in §47.11 required before demo/metering. |
| 10 | Parent View exposure | **NOT AUTHORISED by this adoption.** Separate decision, separate risk review. |
| — | FR-AIT-060 multilingual (Twi/Ga/Ewe/Hausa) | **NOT AUTHORISED** until an evaluation set exists for this domain. Specified, not cleared. |

Stages 0.5–5 are cleared together and deliberately — the demand evidence, the isolation boundary, the evaluation harness, and the enforcement runtime, none of which depends on the provider decision gating stage 6 onward. Stage 0.5 is new in v2.1: a cheap Ask-only slice on a prompt-configured general model (explicitly never to be represented as the Domain AI Model itself), meant to test whether the commercial premise holds before the expensive model-development programme starts.

**This Agent may draft scope-configuration, retrieval-rules, and evaluation-gate code for Chapter 47**, under the same two-approver-plus-domain-owner review posture as finance/results code — per EC-005's 2026-08-27 amendment, reaffirmed (not withdrawn) on 2026-08-29 despite the newly-adopted Internal Engineering Agent v2.1 PDF's Protected Zones table reading, taken literally, as reverting to a full prohibition (see Repository state's flagged inconsistency note). Treat two-approver review as controlling until that PDF text is corrected. This permission isn't tied to a specific stage number — it's categorical (which *kind* of artefact, not which build stage) — but where a stage touches `pbsms-ai/`, it's additionally gated in practice on EC-507 (the write-boundary CI check) actually existing first.

**Correction, 2026-08-29**: the implementation spec drafted 2026-08-27 (`pbsms-platform/apps/api/src/modules/tenant-ai-assistant/STAGE-1-SPEC.md`: retrieval/scope/audit substrate, no model, one vertical slice on attendance) was written against Ch47 v2.0 and calls itself "Stage 1." Under v2.1's renumbered §47.0.2 table, that content — RLS retrieval, capability manifests, validators, audit, no model — is actually **Stage 4–5**, not "Stage 1–2" (v2.1's own Stage 1–2 is model definition/constitution/golden-sets, unrelated content). This matters because Stage 4–5 is unconditionally cleared ("required under every outcome, including abandonment of the model programme") — stronger footing than the Ch47 EC-005 carve-out needed to rely on at all.

**This substrate is already built and merged — done before this correction was written, not by it.** `git log` shows three merged commits on `main` (`cc5f300` "Implement Chapter 47 Stage 1: retrieval, scope enforcement, audit," `4bfdeb8` fixing a Jest-hang in the isolation suite's cleanup, `a7468c8` "Fix 5 real bugs the isolation suite surfaced now it actually runs") predating this session. All ten files the spec called for exist under `modules/tenant-ai-assistant/`, `TenantAiAssistantModule` is registered in `app.module.ts`, and the 16-case `tenant-ai-assistant-isolation.e2e-spec.ts` is merged, listed in `.github/CODEOWNERS`, and registered in `apps/api/tools/check-protected-tests.ts`'s `PROTECTED_FILES` — i.e. it's already an active EC-400 suite. Checked 2026-08-29 against v2.1: none of v2.1's new requirements (Directly Supplied Content, FR-AIT-903, the block-rate signal) touch a zero-LLM, zero-free-text, single-endpoint slice like this one, so the merged code's technical content is still accurate against the new baseline — only `STAGE-1-SPEC.md`'s own document citation (`Ch47_v2_0.pdf`) and stage label are stale, and only as a comment, not as a claim about what's built. This was found mid-session by checking `git log`/`git ls-tree` before starting a redundant rebuild — worth remembering as precedent for verifying a "not built yet" belief against git history, not just against a stale `find`/`ls` on a possibly out-of-sync working tree (the working tree here genuinely was stale from an earlier branch-switch checkout glitch, which is what triggered the check in the first place). `pbsms-platform/README.md`'s completion-record table has been updated to reflect this; nothing else needs building for Ch47 Stage 4–5 substrate specifically.

### Product-feedback pipeline — what's actually built (EC-100/101)

**The capture point exists** (`0046_product_feedback.sql`, `modules/product-feedback/`, Settings' "Report an issue with PBSMS" card, 2026-08-24) — a platform-level, non-RLS'd `product_feedback` table, written by any authenticated staff member (`ALL_STAFF`), keyed by an opaque `tenant_ref` (one-way HMAC-SHA256 of the real `tenant_id`, keyed on `JWT_SECRET` — the real tenant identity is never a column in this table at all, live-verified: the same tenant's two different users produce the identical `tenant_ref`, a different tenant produces a genuinely different one). No support-ticket system or telemetry collection exists yet, but the in-app source EC-100/101 needed is real now.

**Clustering approach settled 2026-08-24: database-native, not embeddings/external NLP.** `0047_product_feedback_clustering.sql` enables `pg_trgm` and grants `pbsms_platform` read access; `infra/queries/product_feedback_clustering.sql` is a runbook of ready-to-run queries — volume/reach per category (plain `GROUP BY`), affected roles (`unnest(role_codes)`), top vocabulary per category (Postgres's built-in `ts_stat`), and near-duplicate report grouping (`pg_trgm` `similarity()`), all live-verified against realistic test data before being committed. Chosen specifically because nothing here sends feedback text to any external service — no DP-103-style provider-vetting decision is reopened for Model B's own tooling. **Real, stated ceiling**: neither technique is true semantic understanding — two reports describing the same bug in genuinely different words ("the export button doesn't work" vs. "can't get my invoice as a PDF") will not be linked by either query. Good enough to try before reaching for anything heavier, not a claim that it's complete.

**The scheduled ingestion/clustering job now exists, closed 2026-08-26**: `0048_product_feedback_digest.sql` + `jobs-worker/handlers/product-feedback-digest.handler.ts`. Deliberately does not reuse the Chapter 35 `background_jobs`/`job_schedules` queue (Phase D) — that queue is per-tenant by construction (RLS'd, `dequeue_next_job()` always scoped to one tenant), while `product_feedback` has no `tenant_id` at all. Instead `worker.ts` gained a fourth, independent timer (`WORKER_FEEDBACK_DIGEST_POLL_MS`, default once/day) that runs the same five runbook queries against a plain `pbsms_worker`-role connection and writes one snapshot row to a new `product_feedback_digests` table per run, skipping the write entirely when there's no new feedback since the last run. Live-verified against synthetic (non-PII) feedback: a real digest row with correct per-category volumes, per-role breakdowns, `ts_stat` vocabulary, and a genuine near-duplicate cluster pairing two differently-worded reports about the same bug; a second run with nothing new correctly skipped; `pbsms_app` confirmed still unable to read either table. This turns the runbook from "a human runs these by hand" into "a human reads an already-computed digest" — it does not add ranking, prioritization, or any judgment about what to build next; that reading is still the Engineering Lead's job.

**What's still not built, on purpose**: any GitHub-issue-writing automation — a digest row is not a filed issue, and EC-100/101 doesn't ask for that leap to be automated. Stated, honest limitation carried over from the capture point itself, unchanged by the job existing: EC-300's request to strip student/guardian names etc. from feedback *content* is a named-entity-recognition problem for free text, not something a migration, a regex, or a SQL clustering query can honestly claim to solve — the submission form asks reporters not to include a name, nothing yet enforces it mechanically. The digest job reads exactly the same unredacted `subject`/`message` text the runbook queries always did, for the same limited `pbsms_platform`-role audience — it doesn't widen that exposure, but it doesn't close it either. Anyone building GitHub-issue automation on top of this needs to solve real redaction first; the opaque `tenant_ref` alone was never the whole anonymisation story.
