# NFR-DEP-050: Rollback Policy

**Status**: adopted policy document, formalizing NFR-DEP-050 (SRS Chapter
38.3) — same category as `docs/quality-assurance/NFR-QA-050-defect-
severity-taxonomy.md` and `docs/api/FR-API-020-versioning-and-deprecation-
policy.md`: policy/configuration, not gated `pbsms-platform` application
code. A real rollback still needs a real deployment pipeline to roll back
within (NFR-DEP-020) — that pipeline doesn't exist yet (no staging/
production environment), so this document defines the trigger conditions
and the two preservation principles now, so they're in place before the
first release that could need them, rather than improvised during one.

## The requirement (NFR-DEP-050, verbatim)

> Rollback triggers include authentication, authorization, academic
> calculation, financial integrity, cross-tenant isolation, migration and
> severe performance failures; valid post-release transactions are
> preserved, and forward-fix migration is preferred over destructive
> restoration wherever safe.

## Rollback trigger categories

A release is rolled back (or forward-fixed — see below) when it causes,
or is credibly suspected of causing, any of:

| Category | Example |
|---|---|
| Authentication failure | Login broken or bypassable for any tenant |
| Authorization failure | A role gate stops enforcing, or enforces the wrong tier |
| Academic calculation failure | Grades, GPA-equivalent aggregates, or promotion decisions compute incorrectly |
| Financial integrity failure | An invoice, payment, allocation, or reversal produces a wrong balance |
| Cross-tenant isolation failure | Any data becomes visible or writable across a tenant boundary — the single highest-severity trigger this repo has (see `tenant-isolation.e2e-spec.ts`, NFR-QA-020) |
| Migration failure | A migration fails partway, or succeeds but leaves the schema in a state the application can't run against |
| Severe performance failure | A request path becomes unusable (timeouts, exhausted connections), not merely slower than an NFR-PERF target |

## The two preservation principles

1. **Valid post-release transactions are preserved.** Rolling back the
   *code* never discards or corrupts data a user validly created after
   the release went out. This repo's existing patterns already give
   rollback something safe to preserve: `results.service.ts`'s
   `reopen()` and Finance's `reversals` mechanism both add a new row
   rather than mutate or delete the old one (see
   `project_pbsms_platform_status` history for why), and NFR-DEP-030's
   additive-first migration convention (enforced by
   `apps/api/tools/check-migration-safety.ts`, EC-502 — see
   `check-migration-safety.spec.ts`) means a schema rollback doesn't
   need to destructively reverse a column or table that valid new rows
   now depend on.
2. **Forward-fix is preferred over destructive restoration wherever
   safe.** Given a choice between (a) shipping a corrective migration/
   patch that fixes the defect going forward, and (b) restoring from a
   backup or reversing a migration destructively, (a) is preferred
   whenever it's possible without leaving the trigger condition active
   in the meantime. `check-migration-safety.ts` already operationalizes
   half of this today: a destructive statement (`DROP TABLE`, an
   unqualified `DELETE`) in a migration fails CI unless explicitly
   annotated as a reviewed exception — the same bias toward additive,
   reversible change that a forward-fix rollback needs, enforced at
   write-time rather than left as a rollback-time judgment call.

## What this document does not do

It does not stand up a rollback *mechanism* — there is no staging/
production environment (NFR-DEP-020's full pipeline) to roll back within
yet, and building one is real infrastructure work gated the same way
other Stage-4 implementation is. This document exists so the trigger
conditions and preservation principles are already decided, reviewable,
and citable before that pipeline's first real release — not something
invented under incident pressure the first time one of the seven
categories above actually fires.
