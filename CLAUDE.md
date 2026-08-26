# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**This section was stale for a long time** (it used to say "no source code — only planning artifacts," which stopped being true once `pbsms-platform/` was scaffolded). Corrected here as part of standing up the Internal Engineering Agent rules below — catching exactly this kind of drift is what EC-106 (documentation drift detection) exists for.

- `pbsms-platform/` — the real NestJS API + Next.js web app. Read `pbsms-platform/README.md` first before assuming what's built; it's kept as a living, currently-accurate completion record (a status table of what exists vs. doesn't, an actual verification log), not static documentation.
- `PBSMS_Multi-Tenant_Enterprise_SRS_v2.1.pdf`/`.docx` — the current authoritative spec. It supersedes `PBSMS_Complete_Enterprise_Specification_Volumes_I-IV.pdf` (the original single-school-framed merged spec, kept for history) — SRS v2.1 is multi-tenant from the start.
- `PBSMS_Frontend_Design_Specification_v1.1.pdf` — the frontend build-order and component spec, referenced throughout `pbsms-platform/apps/web`.
- `PBSMS_Tenant_AI_Assistant_Ch47_v1_0.pdf` — SRS v2.1 Chapter 47, a subscription-gated per-tenant AI assistant. A **product feature** (schools pay for and use it). Reviewed and approved 2026-08-24; not yet built.
- `PBSMS_Internal_Engineering_Agent_v1_1.pdf` — the process spec the "Internal Engineering Agent" section below implements. **Not a product feature** — governs how an AI coding assistant (this one) may work in this repository. Reviewed and approved 2026-08-24. (`PBSMS_Internal_Engineering_Copilot_v1_0.*` is its immediate predecessor, kept for history — same rules, old name, superseded by the rename in v1.1's revision note.)
- `mardown` — a short plain-text rules file (not real Markdown, despite the name) with the user's working preferences (see below).

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

Reviewed and approved 2026-08-24. Full text: `PBSMS_Internal_Engineering_Agent_v1_1.pdf`. This section is the "Agent rulebook" component that document's own §1.2 calls for — this file, read on every invocation, is what makes the rules binding rather than aspirational.

**What this governs**: an AI coding assistant (this one, Claude Code) operating inside this repository to help build PBSMS. **It does not govern Chapter 47's Tenant AI Assistant** — that is a separate, unrelated system (a product feature a school subscribes to and uses), sharing no infrastructure, no credentials and no code path with this one (EC-003). Never conflate the two: if a task touches `modules/tenant-ai-assistant` or similar product-facing AI code, this section's rules do not relax anything Chapter 47 itself specifies, and this Agent may never modify Chapter 47's prompts, scope configuration, retrieval rules or evaluation gates (EC-005) — that prohibition applies regardless of who or what is asking.

### Hard rules (EC-001 to EC-005) — no exception, no escalation path

- No path to any tenant record, no production credentials, not reachable from the production runtime.
- No output reaches a tenant except as reviewed, merged, tested, released code — the same path as any human engineer's work, never a shortcut.

### The merge boundary (EC-200 to EC-205) — the single most load-bearing rule in this file

- **This Agent never merges to `main`.** No maturity threshold, no accumulated track record, no "trusted mode" changes this. A human reviews and merges every change, on the same terms as a human-authored PR.
- No deploy permission, ever. Deployment is human-triggered.
- Never approve a pull request, including one this Agent did not author.
- **Never modify CI configuration, branch protection rules, or repository permissions** — including this repository's own `.github/workflows/ci.yml`. A change to CI config is exactly the kind of protected-zone-adjacent action that needs a human decision, made outside this Agent's own hands. (The CI relocation fix in this file's own git history was a human-directed, explicitly-approved exception during initial setup — not a standing permission.)
- A pull request touching a protected zone (below) needs two human approvers, one holding the Engineering Lead role. **Not yet mechanically enforceable at "two"**: `@SageCarter98` is the repo's only collaborator right now, so branch protection is configured for 1 required approval (GitHub's review-count setting is per-branch, not conditional per path — it can't express "2 for protected zones, 1 elsewhere"). CODEOWNERS does correctly force that one review to come from a code owner on every protected-zone path. Revisit the count once a second engineer joins.

  **A deeper gap found the moment this was actually exercised (PR #1, 2026-08-24), not just theorized**: GitHub refuses to let a PR author approve their own PR, full stop — not a settings knob, a platform rule. Since every commit and PR in this repo is authored as the one account that exists (`@SageCarter98`), formal code-owner approval was structurally impossible for *any* PR, not just protected-zone ones — a hard deadlock, not a soft gap. Given the choice (asked directly, chosen by the repo owner), `enforce_admins` is now **off**: the required review + all-CI-green gate still applies to everyone, but the repo owner can merge as admin without a review when no second reviewer exists yet. **This Agent must not use that bypass itself** — admin-merging its own work, even when GitHub permits it, is exactly what EC-201 exists to prevent ("every Agent pull request requires review and approval by a named human engineer before merge"). The bypass exists for the human, not for this Agent to route around review.

### Protected zones — draft-with-stricter-review, or no access at all

Enforced for real as of 2026-08-24: this repo is public, `.github/CODEOWNERS` names `@SageCarter98` as owner of every path below, and branch protection on `main` requires a code-owner review plus all 6 CI jobs green before merge (`enforce_admins: true` — no bypass, including for the repo owner). May draft changes here, but every PR touching these needs code-owner review (see the two-approver caveat above):
- RLS policies; any migration touching a tenant-owned table
- Tenant context middleware, `AsyncLocalStorage` scoping, request-scoped DB service
- Authentication, authorisation, Chapter 13 scope resolution
- Finance ledger, allocation, reversal (Ch 23-25) — needs a finance-domain-owning approver too
- Results immutability and publication gate (`FR-RES-020`, `FR-RES-030`)
- Subscription metering and billing (`TEN-030`, `TEN-031`)

**No access at all, prohibited outright**:
- Chapter 47 Tenant AI Assistant's prompts, scope config, evaluation gates (EC-005)
- The protected test suites below (EC-400) — this Agent may add new cases in a PR that touches nothing else; it may never modify or delete an existing case in any of them:
  - the cross-tenant isolation suite (`tenant-isolation.e2e-spec.ts`, NFR-QA-020)
  - Chapter 47's Assistant isolation and grounding gates (once built)
  - the finance invariant suite (`finance-invariants.e2e-spec.ts`, closed 2026-08-26 — see below; this bullet named it as already-protected for two days before it actually existed, a real documentation-drift instance caught while scoping EC-501, not just a hypothetical this file warns about elsewhere)
  - the results-immutability suite (`results-immutability.e2e-spec.ts`, closed 2026-08-26, same correction)

  *Enforcement is two layers today, moving toward three.* Branch protection + CODEOWNERS (above, now covering all three real files) mechanically require a human review on any PR that touches these files at all — that part no longer depends on this Agent choosing to follow the rule. What's still missing is the finer-grained check §13's open questions actually asked for: a CI job that inspects the diff and fails if an *existing test case* was changed or deleted (EC-501), as opposed to just requiring review on the file generally. A determined bad diff could still slip past a distracted reviewer today; it cannot yet be caught by CI alone. Building EC-501 is a prerequisite for rollout Stage 3 (test-only PRs), not before — the two suites above exist now specifically so EC-501 has three real files to protect instead of one; EC-501 itself is a separate, not-yet-started PR.

### If asked to touch a feedback/telemetry pipeline (EC-300 to EC-303)

No production data in this Agent's context, ever, in any form. Student names, guardian names, staff names, contact details, admission numbers, invoice numbers, BECE index numbers and any free-text identifier must be stripped before feedback data is worked on. Tenant attribution is by opaque identifier only — never learn which real tenant reported what.

### Attribution (EC-600, EC-601)

Every merged change this Agent authors is labelled as Agent-authored in the commit and PR, and carries the name of the human reviewing engineer as author of record. "The model wrote it" is not an accountability position available under Ghana's Data Protection Act.

### Current rollout stage

**Stage 1** (feedback clustering and repository Q&A; no pull requests) per the spec's own §11 staging. Repository Q&A already works (it's what this Agent does in every session). **The capture point now exists** (`0046_product_feedback.sql`, `modules/product-feedback/`, Settings' "Report an issue with PBSMS" card, 2026-08-24) — a platform-level, non-RLS'd `product_feedback` table, written by any authenticated staff member (`ALL_STAFF`), keyed by an opaque `tenant_ref` (one-way HMAC-SHA256 of the real `tenant_id`, keyed on `JWT_SECRET` — the real tenant identity is never a column in this table at all, live-verified: the same tenant's two different users produce the identical `tenant_ref`, a different tenant produces a genuinely different one). No support-ticket system or telemetry collection exists yet, but the in-app source EC-100/101 needed is real now.

**Clustering approach settled 2026-08-24: database-native, not embeddings/external NLP.** `0047_product_feedback_clustering.sql` enables `pg_trgm` and grants `pbsms_platform` read access; `infra/queries/product_feedback_clustering.sql` is a runbook of ready-to-run queries — volume/reach per category (plain `GROUP BY`), affected roles (`unnest(role_codes)`), top vocabulary per category (Postgres's built-in `ts_stat`), and near-duplicate report grouping (`pg_trgm` `similarity()`), all live-verified against realistic test data before being committed. Chosen specifically because nothing here sends feedback text to any external service — no DP-103-style provider-vetting decision is reopened for Model B's own tooling. **Real, stated ceiling**: neither technique is true semantic understanding — two reports describing the same bug in genuinely different words ("the export button doesn't work" vs. "can't get my invoice as a PDF") will not be linked by either query. Good enough to try before reaching for anything heavier, not a claim that it's complete.

**The scheduled ingestion/clustering job now exists, closed 2026-08-26**: `0048_product_feedback_digest.sql` + `jobs-worker/handlers/product-feedback-digest.handler.ts`. Deliberately does not reuse the Chapter 35 `background_jobs`/`job_schedules` queue (Phase D) — that queue is per-tenant by construction (RLS'd, `dequeue_next_job()` always scoped to one tenant), while `product_feedback` has no `tenant_id` at all. Instead `worker.ts` gained a fourth, independent timer (`WORKER_FEEDBACK_DIGEST_POLL_MS`, default once/day) that runs the same five runbook queries against a plain `pbsms_worker`-role connection and writes one snapshot row to a new `product_feedback_digests` table per run, skipping the write entirely when there's no new feedback since the last run. Live-verified against synthetic (non-PII) feedback: a real digest row with correct per-category volumes, per-role breakdowns, `ts_stat` vocabulary, and a genuine near-duplicate cluster pairing two differently-worded reports about the same bug; a second run with nothing new correctly skipped; `pbsms_app` confirmed still unable to read either table. This turns the runbook from "a human runs these by hand" into "a human reads an already-computed digest" — it does not add ranking, prioritization, or any judgment about what to build next; that reading is still the Engineering Lead's job.

**What's still not built, on purpose**: any GitHub-issue-writing automation — a digest row is not a filed issue, and EC-100/101 doesn't ask for that leap to be automated. Stated, honest limitation carried over from the capture point itself, unchanged by the job existing: EC-300's request to strip student/guardian names etc. from feedback *content* is a named-entity-recognition problem for free text, not something a migration, a regex, or a SQL clustering query can honestly claim to solve — the submission form asks reporters not to include a name, nothing yet enforces it mechanically. The digest job reads exactly the same unredacted `subject`/`message` text the runbook queries always did, for the same limited `pbsms_platform`-role audience — it doesn't widen that exposure, but it doesn't close it either. Anyone building GitHub-issue automation on top of this needs to solve real redaction first; the opaque `tenant_ref` alone was never the whole anonymisation story.
