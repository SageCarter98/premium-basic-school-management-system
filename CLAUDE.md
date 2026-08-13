# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This repository currently contains **no source code** — only planning artifacts:

- `PBSMS_Complete_Enterprise_Specification_Volumes_I-IV.pdf` — the complete requirements/design specification (Chapters 1-55). This is the authoritative source of truth for what PBSMS is and how it must be built.
- `mardown` — a short plain-text rules file (not real Markdown, despite the name) with the user's working preferences (see below).

There is no build system, package manifest, test suite, or application code to run yet. Do not invent commands (build/lint/test) that don't exist — check for their presence again before assuming otherwise, since this file will need to be updated once implementation begins.

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
