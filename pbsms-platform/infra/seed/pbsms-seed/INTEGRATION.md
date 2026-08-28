# Loading the seed fixture into PBSMS

Two loading paths exist, matching two different things worth proving. Do Path 1
first — it's the cheap one and it's the one your RLS coverage gate should run on
every PR.

| Path | Proves | Speed |
|---|---|---|
| 1 — SQL, direct to Postgres | RLS policies actually isolate tenants | Fast |
| 2 — through NestJS services | Validation, tenant-context middleware, AsyncLocalStorage plumbing | Slower |

---

## Before you load anything

The generator doesn't know your schema's exact names. Two files map the fixture
onto it, and both need a quick check against the actual scaffold before the
first load:

- **`src/config.ts`** — `rlsSessionVar` (default `app.tenant_id`). Must match the
  GUC your RLS policies and tenant-context middleware actually read.
- **`src/writers/sql.ts`** — `TABLE_NAMES`. Must match your migrations' actual
  table names (e.g. `enrolments` vs `enrollments`).

Fix these before generating, not after. A load failure caused by a name
mismatch tells you nothing about your schema; a load failure caused by a real
constraint tells you something worth knowing.

---

## Path 1 — SQL, direct to Postgres

### 1. Install

```bash
unzip pbsms-seed.zip && cd pbsms-seed
pnpm install
```

### 2. Generate a fixture

```bash
pnpm seed -- --profile ci --out fixtures/ci
```

`ci` is the smallest profile that still contains every deliberate edge case —
use it for anything running on a pull request. `dev` and `volume` exist for
local development and performance work respectively; see the README for sizes.

### 3. Load it as your APPLICATION role, not the superuser

This is the part that matters. Docker Compose usually hands you a superuser by
default, and a superuser bypasses RLS — loading through it proves nothing about
whether your policies work.

```bash
psql "postgresql://app_role:app_pass@localhost:5432/pbsms_dev" \
  -v ON_ERROR_STOP=1 \
  -f fixtures/ci/seed.sql
```

Check `docker-compose.yml` or your RLS setup docs for the actual non-superuser
role name if `app_role` isn't it. If the load fails partway through, the error
names the table and row — that's a finding about the scaffold, not noise to
suppress.

### 4. Run the isolation probe immediately after

```bash
psql "postgresql://app_role:app_pass@localhost:5432/pbsms_dev" \
  -f fixtures/ci/isolation-probe.sql
```

Every `count(*) AS leaked` row must read `0`. The final `DO $$` block must raise:

```
NOTICE: ok: cross-tenant INSERT rejected
```

If it instead raises `RLS FAILURE: cross-tenant INSERT succeeded`, that's a real
gap in a policy's `WITH CHECK` clause, found before any application code was
written against it.

### 5. Wire it into CI

Add this next to the existing RLS coverage gate — spin up Postgres, run
migrations, then:

```bash
pnpm --filter @pbsms/seed check                       # invariants + determinism, writes nothing
psql "$TEST_DATABASE_URL" -f fixtures/ci/seed.sql
psql "$TEST_DATABASE_URL" -f fixtures/ci/isolation-probe.sql
```

`check` fails the build if the fixture itself is wrong (a cross-tenant
reference, a missing edge case, non-reproducible output) before it ever touches
a database.

---

## Path 2 — through the NestJS services

Catches a different class of bug: a row the SQL path accepts because the
*table* allows it, but your service-layer validation would have rejected.

Implement `SeedSink` against your request-scoped DB service:

```typescript
import { build, loadThroughSink, DEFAULT_CONFIG, type SeedSink } from '@pbsms/seed';
import { tenantContext } from './tenant-context'; // your AsyncLocalStorage wrapper

const sink: SeedSink = {
  withTenant: (tenantId, fn) => tenantContext.run({ tenantId }, fn),
  insert: async (table, rows) => {
    for (const row of rows) {
      await dataSource.getRepository(table).insert(row); // or your service's create()
    }
  },
};

await loadThroughSink(build(DEFAULT_CONFIG), sink);
```

Run this from a throwaway script or an e2e test setup hook — not as a
migration. A row that SQL accepts and the service rejects is a spec
disagreement worth surfacing early, not something to route around.

---

## Which one, when

- **Debugging RLS policies right now** → Path 1. It's the fast one.
- **Writing e2e tests for a controller or service** → Path 2, so tenant-context
  middleware and validation pipes are exercised the way a real request hits
  them.
- **Both, in CI** → Path 1 on every PR (cheap), Path 2 in a slower nightly or
  pre-merge job if you want the belt-and-suspenders check that the two layers
  agree with each other.

---

## Logging in once it's loaded

`fixtures/ci/CREDENTIALS.md` is generated from the same graph you just loaded,
so the emails and passwords in it match exactly what's in the database. It also
lists the five accounts that should *not* simply work (locked, never-activated,
disabled-but-history-retained, conflict-of-interest, and one email shared across
two tenants) — see the README's "Logins" section for what each one is supposed
to prove.

**Never point this generator, or the resulting hashes, at an environment that
holds real people's data.** The passwords are published and the salts are
derived rather than random — deliberate, for reproducibility, but only safe
inside a database nobody outside the team can reach.

---

## One open question before you standardize on this

If the existing code scaffold's cross-tenant isolation suite (NFR-QA-020)
already loads fixtures some other way, that's worth reconciling before this
becomes the team's second, competing loading convention. If you can point to
how it currently loads data, the SQL writer here can be adjusted to match
rather than adding a parallel path.
