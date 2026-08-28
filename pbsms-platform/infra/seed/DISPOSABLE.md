# Everything under infra/seed/ is disposable dev/CI fixture data

Nothing here is ever meant to run against a database holding real tenant
data, and nothing here is part of the production deploy path. Structurally:

- `infra/migrations/` (schema, `npm run migrate`) is the only thing that
  runs against a real database. `infra/seed/` runs via a separate,
  explicitly-invoked `npm run seed` command that no deploy/release workflow
  calls.
- `seed_demo.sql` — two hand-written demo tenants, used for local dev and by
  `tenant-ai-assistant-isolation.e2e-spec.ts` and friends in CI.
- `pbsms-seed/` — a deterministic synthetic multi-tenant fixture generator
  (see its own `README.md`). Its `fixtures/ci/` output is committed
  (small, ~12MB, the smallest profile that still covers every deliberate
  edge case); the larger `dev`/`volume` profiles are gitignored.
  **Not yet wired into CI or actually usable against the real schema** —
  see `pbsms-seed/SCHEMA-RECONCILIATION.md` for what's blocking that.

**Before a production go-live**: check this directory is either deleted or
definitively confirmed to be unreachable from anything that runs against a
real tenant database. That's a one-directory check, by design, rather than
needing to track scattered seed-related changes across the codebase.
