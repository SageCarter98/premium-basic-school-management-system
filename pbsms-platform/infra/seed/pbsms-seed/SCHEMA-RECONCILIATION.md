# Schema reconciliation status

`@pbsms/seed`'s SQL writer (`src/writers/sql.ts`, `TABLE_NAMES`) was built against
an assumed schema shape, not this repo's actual migrations. This file is the
honest record of reconciling the two, done while wiring the tool into
`infra/seed/` (2026-08-28). **Path 1 (SQL, direct to Postgres) is not usable
yet** — most of the mismatches below are unresolved.

Checked against every `create table` in `infra/migrations/*.sql`, not assumed.

## Fixed (real 1:1 renames, applied in `src/config.ts` / `src/writers/sql.ts`)

| Generator name | Real table | Note |
|---|---|---|
| `rlsSessionVar: app.tenant_id` | `app.current_tenant` | RLS GUC name, `src/config.ts` |
| `teaching_assignments` | `teacher_assignments` | |

## Confirmed renames, NOT yet applied (need the same treatment as above)

| Generator name | Real table | Confidence |
|---|---|---|
| `guardian_links` | `student_guardians` | High — same many-to-many concept |
| `audit_events` | `audit_log` | High — confirmed live in a CI run's Postgres log |
| `result_sets` / `result_lines` | `student_results` / `student_result_items` | High |
| `fee_items` | `fee_structure_items` | High |
| `invoice_lines` | `invoice_items` | High |
| `allocations` | `payment_allocations` | High |
| `provider_settlements` | `settlement_batches` | High |
| `grading_scales` / `grade_bands` | `grading_policies` / `grading_scale_items` | High |
| `message_templates` / `message_batches` / `message_deliveries` | `notification_templates` / `notifications` / `notification_deliveries` | Medium — names line up, column shapes not diffed |

`result_versions` has no separate table — `student_results` carries `version`
and `previous_version_id` columns directly (a self-referencing version chain,
not a child table). The generator's three-table result concept needs
reshaping to two, not just renaming.

`user_roles` and `staff` both collapse into one real table, `tenant_users`
(`id, tenant_id, user_id, role_code`) — there is no employment-record table
separate from a person's `users` row, and no separate role-assignment table
either. This is a graph-shape change, not a rename: the generator currently
treats "a person," "their employment record," and "their role" as three
linked entities: `TABLE_NAMES` has no slot for a two-table concept collapsing
into one, one of `staff`/`user_roles` would need to become a no-op with its
fields merged into the other's insert.

## Real structural gaps — the real schema has no table for these at all

| Generator concept | Status |
|---|---|
| `terms` | **No table.** `academic_years` has no per-term columns either (just `start_date`/`end_date` for the whole year). The Ghanaian three-term calendar the generator models isn't represented in the schema at all yet. |
| `divisions`, `class_levels` | **No table.** `classes.level` is a free-text column (`'JHS 2'`), not a foreign key to a reference table. |
| `invitations` | **No table anywhere** (`grep -r invitation infra/migrations/` — zero matches). The "staff invited, not yet activated" login-state edge case this generator deliberately seeds has nowhere real to go. |

Adding these to the schema is a real product/schema decision (does PBSMS
model terms as data, or keep term dates implicit?), not something to decide
inside a seed-tool integration. Flagging here rather than guessing.

## Needs a product decision, not a mechanical rename

| Generator concept | Candidates | Why it's not obvious |
|---|---|---|
| `access_links` (guardian passwordless link) | `guardian_access_grants`, `guardian_access_requests` | Two real tables exist in this area; which one (or both) represents "a live/expired/consumed single-use link" needs someone who knows that module to say |
| `assessment_instances` (one administered assessment) | `assessment_structures`, `assessment_components`, `scores` | No table represents "an occurrence of an assessment" as its own row — might already be implicit in how `scores` rows group, might need one of the existing tables read differently |
| `metering` (TEN-030 subscription metering) | none found | `0024_billing.sql` only creates `platform_invoices` — no metering/usage-snapshot table exists yet |
| `platform_users` | `users` (with `is_platform_user = true`) + `platform_user_roles` | Same collapse pattern as `staff`/`user_roles` above |

## Recommendation

Given the scope above, loading this fixture via Path 1 today would fail
partway through on the first genuinely-missing table it hits (`terms`, most
likely, since `TABLE_NAMES` still lists it first among the unmapped ones) —
that failure would be correctly diagnostic per the tool's own README
("a load failure caused by a real constraint tells you something worth
knowing"), but it isn't yet a usable loading path for day-to-day CI use.

Two ways forward, worth deciding rather than defaulting into one:
1. Finish the reconciliation — apply the confirmed renames above, then work
   through the "needs a product decision" and "structural gaps" sections with
   whoever owns each area (academic calendar, communications, billing,
   guardian access, auth).
2. Try Path 2 (through the NestJS services, `SeedSink`) instead of Path 1 for
   now — it might tolerate some of this better since it goes through real
   service methods rather than needing exact raw-table parity, though the
   structural gaps (no `terms`/`invitations` table) would still block
   whatever service call tries to use them.
