# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**This section was stale for a long time** (it used to say "no source code — only planning artifacts," which stopped being true once `pbsms-platform/` was scaffolded). Corrected here as part of standing up the Internal Engineering Agent rules below — catching exactly this kind of drift is what EC-106 (documentation drift detection) exists for.

- `pbsms-platform/` — the real NestJS API + Next.js web app. Read `pbsms-platform/README.md` first before assuming what's built; it's kept as a living, currently-accurate completion record (a status table of what exists vs. doesn't, an actual verification log), not static documentation.
- `PBSMS_Multi-Tenant_Enterprise_SRS_v2.1.pdf`/`.docx` — the current authoritative spec. It supersedes `PBSMS_Complete_Enterprise_Specification_Volumes_I-IV.pdf` (the original single-school-framed merged spec, kept for history) — SRS v2.1 is multi-tenant from the start.
- `PBSMS_Frontend_Design_Specification_v1.1.pdf` — the frontend build-order and component spec, referenced throughout `pbsms-platform/apps/web`.
- `PBSMS_Tenant_AI_Assistant_Ch47_v2_2_Adopted.pdf` — SRS v2.1 Chapter 47, a subscription-gated per-tenant AI assistant. A **product feature** (schools pay for and use it). Current adopted baseline as of 2026-08-30, superseding v2.1 (adopted 2026-08-29) and v2.0 (adopted 2026-08-27), both kept for history alongside `v1_0`. **v2.1 → v2.2**: opens the "owned model artifact" requirements (FR-AIT-701/702, NFR-AIT-104 to 106) to permit a hosted model instead of requiring a PBSMS-owned/trained one, and adds **FR-AIT-708** — no model may carry tenant traffic until benchmarked against at least two alternatives (one open-weight) on the full §47.16 evaluation suites, with constitution/tools/evidence/validator held identical. **v2.0 → v2.1** made a named, versioned PBSMS Domain AI Model the primary artifact and added four capabilities v2.0 didn't permit (Research, Controlled Live Internet Research, General Conversation, Combined Analysis). §47.0.2's staged build-authorization table was renumbered in v2.2 (a new Stage 0.5 was inserted, shifting everything after it — see the Internal Engineering Agent section below for the current table and how it maps onto the existing `STAGE-1-SPEC.md` numbering). §47.18's open questions substantially narrow at v2.2 (base model/provider is now a measurement via FR-AIT-708, not an open argument) but Parent View and FR-AIT-060 multilingual remain **NOT AUTHORISED**.
- `PBSMS_Claude_As_Tenant_AI_Assistant_v2_0.pdf` — an adaptation assessment proposing Claude, via the Anthropic API, as the hosted model behind Chapter 47's Tenant AI Assistant, plus a model-agnostic deployables inventory and behaviour-bundle design. **The document states outright that it was written by Claude assessing whether Claude should be adopted** — a declared conflict of interest its own §1.1 names explicitly. Adopted 2026-08-30 in two parts: the architecture, behaviour bundle and deployables inventory (§4–§7) are adopted **unconditionally** (model-agnostic, required regardless of which provider wins); Claude as the selected provider is adopted only as the **presumptive candidate**, conditional on winning the FR-AIT-708 benchmark against ≥2 alternatives on PBSMS's own corpus — cleared for development and internal-shadow work, **not cleared to carry tenant traffic**. Confirmed by the repo owner as an authentic, authorized artifact (not independently verified against an external adoption record) — see the Internal Engineering Agent section for what this changes about what may currently be built.
- `PBSMS_Internal_Engineering_Agent_v2_0.pdf` — the process spec the "Internal Engineering Agent" section below implements. **Not a product feature** — governs how an AI coding assistant (this one) may work in this repository. **Supersedes v1.1 as of 2026-08-27** — v2.0's own status header genuinely says "ADOPTED — APPROVED FOR IMPLEMENTATION," no drift. New §1.3 governs amendment (**the PDF's own text names EC-005, EC-302 and EC-400 as not amendable by the ordinary process** — changing any of the three requires re-adoption of the whole document; EC-005 was nonetheless amended by direct Engineering Lead commit on 2026-08-27, see the EC-series section below for the full account) and gives a staged implementation-authorization table (see below). No EC rule's substance changed from v1.1 to v2.0 itself. **A further amendment to v2.1 is referenced by Ch47 v2.2 §47.0.5 (new EC-507, extended EC-005/EC-400 covering the `pbsms-ai/` tree) but no v2.1 PDF exists anywhere in this repo or its history** — the EC-series section below reflects that amendment's substance as described secondhand in Ch47 v2.2, not from a primary v2.1 document; treat that provenance gap as live until a real v2.1 artifact turns up. (`PBSMS_Internal_Engineering_Copilot_v1_0.*` and `PBSMS_Internal_Engineering_Agent_v1_1.*` kept for history.)
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

**ADOPTED — APPROVED FOR IMPLEMENTATION, 27 August 2026** (v2.0, superseding v1.1 — see Repository state above). This is the first time this section has ever matched a genuinely adopted document rather than a "reviewed and approved" claim the source PDF itself contradicted; that drift (found and fixed twice this session, PRs #7 and #9) is now moot because v2.0's own header says ADOPTED and means it. No EC rule's substance changed between v1.1 and v2.0 — v2.0 only added §1.3 (amendment process and a staged implementation-authorization table, below). This section is the "Agent rulebook" §1.2 calls for — read on every invocation, it's what makes the rules binding rather than aspirational.

**What this governs**: an AI coding assistant (this one, Claude Code) operating inside this repository to help build PBSMS. **It does not govern Chapter 47's Tenant AI Assistant** — a separate, unrelated system (a product feature a school subscribes to and uses), sharing no infrastructure, no credentials and no code path with this one (EC-003).

### Amendment (§1.3) — read this before touching any EC rule

- Amending any EC rule requires a version increment and re-adoption by whoever holds the Engineering Lead role. EC identifiers are permanent; a withdrawn rule is marked withdrawn and retained, never deleted.
- **EC-302 and EC-400 are not amendable by the ordinary process at all.** Changing either requires re-adoption of the whole document — not a CLAUDE.md edit, not an in-session instruction, no matter who gives it. They remain the rules whose entire value is that they cannot be relaxed by whoever is under pressure at the time, and neither has been touched.
- **Correction, 2026-08-27 (morning)**: earlier the same day, before v2.0 arrived, this Agent drafted and opened a PR amending EC-005 in CLAUDE.md directly, following an explicit in-session instruction from the repo owner. That PR (#10) was invalid under v2.0's then-current text and was closed without merging. The mistake was treating EC-005 as EC-201-style (a rule with documented precedent for a narrow, human-authorized exception the *Agent* could act on once asked) rather than checking whether it carried its own, stricter amendment rule — it did, at the time.
- **EC-005 amended, 2026-08-27 (afternoon), by direct commit from whoever holds the Engineering Lead role** — not drafted, requested, or executed by this Agent; the repo owner committed the change to CLAUDE.md themselves. This is a materially different act from the morning's invalid PR: it's the named Engineering Lead's own direct exercise of the authority §1.3's first bullet already gives them ("amending any EC rule requires... re-adoption... by whoever holds the Engineering Lead role"), not a request routed through or pressuring this Agent. Whether one CLAUDE.md commit fully satisfies "re-adoption of the whole document" as a literal reference to the external `PBSMS_Internal_Engineering_Agent` PDF is left open here rather than resolved unilaterally by this Agent either way — what's unambiguous is that the person authorized to hold this document accountable made the call directly, on the record, in their own commit. EC-302 and EC-400 remain fully intact, untouched by it.
- Advancing a rollout stage is an explicit, recorded decision by the Engineering Lead against the stated advance condition — never by drift, consensus, or a previous stage running a while without incident.

### Hard separation from the product (EC-001 to EC-005) — no exception, no escalation path

- EC-001 — not deployed in, callable from, or reachable by the PBSMS production runtime.
- EC-002 — no credentials to any production database, no production API keys, no path to any tenant record.
- EC-003 — this Agent and the Tenant AI Assistant (Chapter 47) share no infrastructure, no credentials, no code path. A compromise of one must not reach the other.
- EC-004 — no output of this Agent reaches a tenant except as reviewed, merged, tested, released code, on exactly the same path as any human engineer's work.
- **EC-005 — amended 2026-08-27 (see §1.3 above for how).** This Agent may assist in developing and implementing Chapter 47 artefacts — the Assistant's prompts, scope configuration, retrieval rules, and evaluation gates — under the same protected-zone review posture as any other safety-critical code in this repo (two human approvers, one holding Chapter-47/AI domain ownership; see Protected zones below). This does not relax EC-400 separately: an evaluation-gate test suite (e.g. the Chapter 47 isolation/grounding suite) may be Agent-drafted under that same review, exactly as `finance-invariants.e2e-spec.ts` and `results-immutability.e2e-spec.ts` were — but once it exists and is merged, this Agent may add new cases in a PR touching nothing else and may never modify or delete an existing one, same as those two files.

  **Further amendment referenced 2026-08-29 (known only secondhand — see Repository state's provenance note on the missing v2.1 PDF).** Ch47 v2.2 §47.0.5 describes a follow-on EC-005 amendment placing the **entire `pbsms-ai/` tree out of Agent write-reach**, once that tree exists — read access is retained for repository question-answering, but no Agent PR may create, modify, rename or move anything under it. The stated reason: `pbsms-ai/` will hold the Model Constitution, dataset manifests and the blind evaluation corpus that every §47.16 release decision depends on, and unlike the prompts/scope-config/retrieval-rules EC-005 already covers, a change to the *evaluation corpus itself* would fail no existing CI gate while silently invalidating every certification built on top of it. This is a stricter rule than the 2026-08-27 EC-005 text above (which permits Agent-drafted artefacts under two-approver review) — for `pbsms-ai/` specifically, there is no draft-under-review path at all, only read.

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
- EC-400 — the following suites shall be human-authored and immutable to this Agent; it may propose additional cases in a PR touching nothing else, never modify or delete an existing one. **Not amendable by the ordinary process** (see above):
  - the cross-tenant isolation suite (`tenant-isolation.e2e-spec.ts`, NFR-QA-020)
  - Chapter 47's Assistant isolation and grounding gates (may be Agent-drafted under the same two-approver review as the two suites below, per EC-005's 2026-08-27 amendment — "human-authored" here means protected from Agent modification once merged, not barred from Agent-drafted initial authorship, same pattern the two suites below already establish)
  - the finance invariant suite (`finance-invariants.e2e-spec.ts`, closed 2026-08-26)
  - the results-immutability suite (`results-immutability.e2e-spec.ts`, closed 2026-08-26)
  - **added 2026-08-29 (secondhand, see the EC-005 note above)** — the `pbsms-ai/` blind evaluation corpus, dataset manifests and hashes, the captured web corpus, the adversarial corpus, and the scorers computing the §47.16.2 release metrics. Same rule as the rest of EC-400: this Agent may propose additional cases in a PR touching nothing else, never modify or delete an existing one.

  *Enforcement is three layers as of 2026-08-26 for the four suites above the 2026-08-29 addition.* Branch protection + CODEOWNERS mechanically require human review on any PR touching these files at all. `apps/api/tools/check-protected-tests.ts` (the EC-501 job) parses each protected file with the TypeScript compiler API, hashes every `it(...)`/`test(...)` call's normalized body, and fails the build if any hash present at the PR's base commit is missing at head — a kept title with a gutted body still fails, since matching is by content. New cases never flagged. Live-verified against all three failure modes before merging. **The `pbsms-ai/` addition is now mechanically enforced too, built 2026-08-31** — see EC-507 in the CI gates table below (`apps/api/tools/check-pbsms-ai-boundary.ts`). Per Ch47 v2.2 §47.0.5's own words, "until EC-507 runs in CI the boundary is a convention rather than a control" — that condition is now satisfied for Agent PRs specifically; note it still has no CODEOWNERS/branch-protection backstop the way the four suites above do, since `pbsms-ai/`'s real path can't be added to `.github/CODEOWNERS` until the tree actually exists.

### CI gates for Agent pull requests (EC-500 to EC-506)

A pull request passes every gate below before a human is asked to look at it — spending reviewer attention on something an automated check would reject is the fastest way to make reviewers stop reading carefully.

| ID | Gate | Status |
|---|---|---|
| — | Existing pipeline: SAST, dependency scan, RLS coverage gate, cross-tenant isolation suite, accessibility gate | Built, running in `ci.yml` |
| EC-500 | Protected-path check — diff touches a protected zone without the required label/approver count | **Built, 2026-08-27** (`apps/api/tools/check-protected-path.ts`, the `agent-pr-gates` job) |
| EC-501 | Immutable-suite check — any protected test file modified or deleted | **Built, 2026-08-26** (`apps/api/tools/check-protected-tests.ts`, the `protected-test-integrity` job) |
| EC-502 | Migration safety check — a destructive migration with no explicit, separately-reviewed exception | **Built, 2026-08-27** (`apps/api/tools/check-migration-safety.ts`) |
| EC-503 | Diff ceiling — change exceeds the reviewable size limit (proposed 400 changed lines), not split | **Built, 2026-08-27** (`apps/api/tools/check-diff-ceiling.ts`); the 400-line figure is a guess per the spec's own Open Questions, to be re-set from stage-3 measurement. |
| EC-504 | Traceability check — PR doesn't reference the SRS requirement IDs it implements/changes | **Built, 2026-08-27** (`apps/api/tools/check-traceability.ts`) |
| EC-505 | Behaviour-change flag check — a user-visible workflow change ships with no feature flag (EC-311) | **Built, 2026-08-27** (`apps/api/tools/check-behaviour-flag.ts`) |
| EC-506 | Attribution check — commit/PR not labelled Agent-authored | **Built, 2026-08-27** (`apps/api/tools/check-attribution.ts`) |
| EC-507 | `pbsms-ai/` boundary check — Agent PR diff touches the `pbsms-ai/` tree at all, including a rename or move | **Built, 2026-08-31** (`apps/api/tools/check-pbsms-ai-boundary.ts`, same `agent-pr-gates` job — no separate branch-protection change needed since it's a step inside an already-required job). Detects "Agent-authored" the same way EC-506 does (a `Co-Authored-By: Claude` commit trailer); a PR with no such trailer is left alone, since `pbsms-ai/` content is meant to come from the Engineering Lead per the Chapter 47 table below. `pbsms-ai/`'s real location doesn't exist anywhere yet (see Repository state's provenance note), so the check matches any `pbsms-ai` path segment rather than one guessed location — revisit once the tree's real path is known. |

**2026-08-27 documentation drift, found and fixed 2026-08-31**: this table previously claimed EC-500 and EC-502 to EC-506 were "Not built. Cleared to build now" — they were in fact already built and wired into `ci.yml`'s `agent-pr-gates` job the same day (2026-08-27, commit `f7efdaf`), just never reflected here. Caught while building EC-507 alongside them. Exactly the kind of drift EC-106 exists to catch — recorded honestly rather than quietly corrected.

### Accountability (EC-600 to EC-602)

Every merged change this Agent authors is labelled Agent-authored in the commit and PR, and carries the name of the human reviewing engineer as author of record — "the model wrote it" is not an accountability position available under Ghana's Data Protection Act. An incident caused by an Agent-authored change is reviewed as a failure of the gates and the process (EC-602), not of the reviewer alone.

### EC-700 — suspension condition

If the defect-escape rate of Agent-authored merged changes exceeds the human baseline over two consecutive quarters, or any Agent-authored change causes a cross-tenant data exposure, implementation capability (EC-104 drafting change proposals as code, EC-105 test authoring) is suspended immediately; only analysis capabilities (EC-100 to EC-103, EC-107) are retained pending review. No baseline exists yet to compare against (see the authorization table below) — establishing one is a stage-4 prerequisite.

### What's actually authorized right now (§1.3's staged table) — read before starting *any* new work

This is the single most operationally important addition v2.0 makes. Adoption authorises implementation, but not all at once — three prerequisites are external and can't be closed by starting work anyway:

| Item | Authorization, 2026-08-27 |
|---|---|
| CLAUDE.md rulebook; CODEOWNERS + branch protection | CLEARED, done |
| Chapter 47 (Model A) governance-runtime artefact authorship (retrieval/scope/audit — Stage 4–5 under Ch47 v2.2's renumbering, `STAGE-1-SPEC.md`) | **CLEARED, 2026-08-27** — EC-005 amendment above; two-approver-plus-domain-owner review applies, same as finance/results. Does **not** extend to the `pbsms-ai/` tree (Ch47 v2.2 Stages 1–2) — that's the stricter, no-draft-path restriction added 2026-08-29, see the EC-series section's Chapter 47 build-authorization table. |
| EC-501 immutable-suite CI check | CLEARED, done (2026-08-26) |
| EC-500, EC-502 to EC-506 gates | **CLEARED — begin immediately. Not yet built; a genuinely available next task.** |
| Repository question-answering (EC-102) | CLEARED, in continuous use every session |
| Feedback ingestion & clustering (EC-100/101) | BUILD CLEARED (done — capture 2026-08-24, clustering 2026-08-24, digest job 2026-08-26), **operation deferred** — no real tenants exist yet, so there's no feedback signal to actually cluster in production |
| Gap detection (EC-107) | **CLEARED — begin immediately. Not yet built.** |
| Stage 3 — test-only pull requests | CLEARED (EC-501 exists — the gate condition is satisfied). PR #5's finance/results invariant suites already exercised this, one PR ahead of EC-501 itself existing — a real sequencing slip, harmless in outcome, worth remembering as precedent for reading a gate's condition before starting, not after. |
| **Stage 4 onward — general implementation PRs (code changes outside protected zones)** | **GATED on a human defect-escape baseline existing (§9/§13). Does not exist yet — takes roughly a quarter of ordinary human-authored development to produce, and cannot be shortcut. Not yet authorized.** |
| Stage 6 — protected-zone drafting | **NOT AUTHORISED by this adoption.** A separate, explicit Engineering Lead decision, not automatic on stages 1–5. |

**What this means in practice**: outside the specifically-cleared categories above (feedback pipeline, gap detection, EC-501-style CI tooling, repo Q&A, docs), this Agent should not take on ordinary PBSMS feature-implementation work until the Stage-4 defect-escape baseline exists. The already-merged feature work in this repo's history either predates 2026-08-24 governance entirely (direct commits, no PR process yet existed) or falls inside an explicitly-cleared category above — none of it needs to be revisited, but *new* general implementation tasks do need this gate checked first, not assumed open because past tasks happened to fit a cleared category.

**Tracked open item, 2026-08-27**: an automated "find *and fix*" bug capability (as distinct from EC-107's gap detection, which only reports) was asked about in-session. It would fall under EC-104 (Implementation), which is general implementation capability — already covered by the Stage-4 gate above. Not something to build or scope further until that baseline exists; noted here so it isn't re-raised as if it were a gap in this file rather than a deliberate wait.

### Chapter 47 (Model A) build authorization (§47.0.2)

Chapter 47 **v2.2** is its own ADOPTED BASELINE, APPROVED FOR BUILD (2026-08-30) — see Repository state above. Its build order is staged independently of this Agent's own EC-series rollout stages above; the two gate different things (Chapter 47's own table says what may be built and when; EC-005 above, as amended, says who may draft it and under what review).

**Renumbering warning**: v2.2 inserted a new Stage 0.5 ahead of the old Stage 1 and shifted every stage after it. `STAGE-1-SPEC.md` (drafted 2026-08-27, under Ch47 v2.0's numbering) describes what v2.2 now calls **Stage 4–5** (retrieval/scope/audit substrate, no model). It is still the concrete basis for that work — nothing about the actual spec changed, only the label — but don't confuse it with the new Stage 1 below, which is a different thing (behaviour-bundle/registry definition, not retrieval).

| Stage | Scope | Authorization |
|---|---|---|
| 0.5 | Demand validation — Ask only, staff only, read-only, on the governance runtime with a prompt-configured general model behind the model adapter | **CLEARED.** Internal and consenting-canary measurement only. Never released, marketed or described as the PBSMS Domain AI Model (FR-AIT-702). |
| 1–2 | Model definition, registry, constitution; synthetic corpus, golden sets, adversarial corpus, evaluation harness | **CLEARED — begin immediately.** No tenant data, no production credentials, no unrestricted internet. This is where `pbsms-ai/` gets created — see EC-005/EC-400/EC-507 above before writing anything here. |
| 3 | Base-model selection and PBSMS adaptation (FR-AIT-708 benchmark: ≥2 alternatives, one open-weight, identical constitution/tools/evidence/validator) | **CLEARED for work on approved non-tenant data only.** This is also the mechanism that decides whether Claude remains the presumptive provider — see the `PBSMS_Claude_As_Tenant_AI_Assistant_v2_0.pdf` entry in Repository state. |
| 4–5 | Governance runtime; operational retrieval under RLS (= old "Stage 1", `STAGE-1-SPEC.md`) | **CLEARED.** Required under every outcome, including abandonment of the model programme. |
| 6 | Research collections and Controlled Live Internet Research | GATED on the privacy/DLP/network gates in §47.8 and §47.16.2 being green, and on search/browsing providers assessed under DP-113. |
| 7 | Live tenant retrieval — operational shadow | GATED on a model-hosting arrangement contractually satisfying DP-103, DP-104 and DP-107 — unresolved, survives adoption per §47.0.3. |
| 8–9 | Canary, then Draft, Explain, Find, Combined Analysis, demo and metering | GATED on the preceding stage. Commercial limits in §47.11 required before demo/metering. |
| 10 | Parent View exposure | **NOT AUTHORISED by this adoption.** Separate decision, separate risk review. |
| — | FR-AIT-060 multilingual (Twi/Ga/Ewe/Hausa) | **NOT AUTHORISED** until an evaluation set exists for this domain. Specified, not cleared. |

Stages 0.5 through 5 are cleared together and deliberately — they're the demand evidence, the isolation boundary, the evaluation harness and the enforcement runtime, none of which depends on the provider decision gating everything after. **As of EC-005's 2026-08-27 amendment (above), this Agent may draft the scope-configuration, retrieval-rules, and evaluation-gate code for what's now Stage 4–5**, under the same two-approver-plus-domain-owner review posture as finance/results code — not unreviewed, but no longer barred from authorship either. **Stages 1–2 (the `pbsms-ai/` tree itself — constitution, registry, corpora) fall under the stricter, no-draft-path EC-005/EC-400 restriction added 2026-08-29**: this Agent may answer questions about that tree once it exists, but may not write to it, regardless of review posture, until a real v2.1 Agent-doc artifact resolves the provenance gap noted in Repository state.

**Cross-reference to the Claude-as-provider assessment**: its Zone A/B (provider adapter, model pinning, behaviour bundle) is provider-specific work — gated the same way Stage 3 above is gated, developable but not tenant-facing until FR-AIT-708's benchmark runs. Its Zones C–I (governance runtime, retrieval, validation, research, audit, evaluation, frontend — ~45 of 61 deployables) are model-agnostic and map onto Stages 1–2 and 4–5 above; they're required whichever provider wins or even if the model programme is abandoned entirely, so there's no reason to wait on the benchmark to start that work.

### Product-feedback pipeline — what's actually built (EC-100/101)

**The capture point exists** (`0046_product_feedback.sql`, `modules/product-feedback/`, Settings' "Report an issue with PBSMS" card, 2026-08-24) — a platform-level, non-RLS'd `product_feedback` table, written by any authenticated staff member (`ALL_STAFF`), keyed by an opaque `tenant_ref` (one-way HMAC-SHA256 of the real `tenant_id`, keyed on `JWT_SECRET` — the real tenant identity is never a column in this table at all, live-verified: the same tenant's two different users produce the identical `tenant_ref`, a different tenant produces a genuinely different one). No support-ticket system or telemetry collection exists yet, but the in-app source EC-100/101 needed is real now.

**Clustering approach settled 2026-08-24: database-native, not embeddings/external NLP.** `0047_product_feedback_clustering.sql` enables `pg_trgm` and grants `pbsms_platform` read access; `infra/queries/product_feedback_clustering.sql` is a runbook of ready-to-run queries — volume/reach per category (plain `GROUP BY`), affected roles (`unnest(role_codes)`), top vocabulary per category (Postgres's built-in `ts_stat`), and near-duplicate report grouping (`pg_trgm` `similarity()`), all live-verified against realistic test data before being committed. Chosen specifically because nothing here sends feedback text to any external service — no DP-103-style provider-vetting decision is reopened for Model B's own tooling. **Real, stated ceiling**: neither technique is true semantic understanding — two reports describing the same bug in genuinely different words ("the export button doesn't work" vs. "can't get my invoice as a PDF") will not be linked by either query. Good enough to try before reaching for anything heavier, not a claim that it's complete.

**The scheduled ingestion/clustering job now exists, closed 2026-08-26**: `0048_product_feedback_digest.sql` + `jobs-worker/handlers/product-feedback-digest.handler.ts`. Deliberately does not reuse the Chapter 35 `background_jobs`/`job_schedules` queue (Phase D) — that queue is per-tenant by construction (RLS'd, `dequeue_next_job()` always scoped to one tenant), while `product_feedback` has no `tenant_id` at all. Instead `worker.ts` gained a fourth, independent timer (`WORKER_FEEDBACK_DIGEST_POLL_MS`, default once/day) that runs the same five runbook queries against a plain `pbsms_worker`-role connection and writes one snapshot row to a new `product_feedback_digests` table per run, skipping the write entirely when there's no new feedback since the last run. Live-verified against synthetic (non-PII) feedback: a real digest row with correct per-category volumes, per-role breakdowns, `ts_stat` vocabulary, and a genuine near-duplicate cluster pairing two differently-worded reports about the same bug; a second run with nothing new correctly skipped; `pbsms_app` confirmed still unable to read either table. This turns the runbook from "a human runs these by hand" into "a human reads an already-computed digest" — it does not add ranking, prioritization, or any judgment about what to build next; that reading is still the Engineering Lead's job.

**What's still not built, on purpose**: any GitHub-issue-writing automation — a digest row is not a filed issue, and EC-100/101 doesn't ask for that leap to be automated. Stated, honest limitation carried over from the capture point itself, unchanged by the job existing: EC-300's request to strip student/guardian names etc. from feedback *content* is a named-entity-recognition problem for free text, not something a migration, a regex, or a SQL clustering query can honestly claim to solve — the submission form asks reporters not to include a name, nothing yet enforces it mechanically. The digest job reads exactly the same unredacted `subject`/`message` text the runbook queries always did, for the same limited `pbsms_platform`-role audience — it doesn't widen that exposure, but it doesn't close it either. Anyone building GitHub-issue automation on top of this needs to solve real redaction first; the opaque `tenant_ref` alone was never the whole anonymisation story.
