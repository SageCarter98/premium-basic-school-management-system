# @pbsms/seed

Deterministic, multi-tenant fixture generator for PBSMS.

No public dataset exists at the grain this system needs — per-student rows *plus*
guardians, invoices, allocations, term-scoped scores, attendance registers *and*
tenant partitioning. Ghana's EMIS Annual School Census is school-level aggregate
data, and importing real pupil records into a dev environment is a Data
Protection Act problem before it is an engineering one. This package generates
the graph instead.

Every row here is invented. Nothing corresponds to a real person or school.

---

## Quick start

```bash
pnpm install
pnpm seed:ci          # small graph, invariants + determinism check, writes fixtures/ci
pnpm report:ci        # prints where every edge case lives in the generated graph
pnpm check            # invariants only, writes nothing — this is the CI gate
```

Load it:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f fixtures/ci/seed.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f fixtures/ci/isolation-probe.sql
```

---

## Three design decisions worth knowing about

**It is deterministic.** `Math.random` is banned in this package. The same seed
produces a byte-identical graph, verified by `--verify-determinism`, which builds
twice and compares SHA-256 fingerprints. A fixture that shifts between runs
cannot be used in CI, because a failing test can't be replayed. Named RNG
sub-streams (`rng.stream('finance')`) mean adding a student later doesn't
reshuffle every invoice number in the diff.

**It generates three tenants, not one.** One tenant cannot prove isolation. Two
cannot distinguish "leaks to any other tenant" from "leaks to the next tenant in
insert order". The third (`mountzion`) is suspended, because subscription gating
is enforced at the API layer and needs a subject.

**It checks itself.** `invariants.ts` runs on every build and is fatal on
failure. A seed generator that emits a subtly wrong graph is worse than no
generator, because every test built on it inherits the error and then encodes it
as the expected result. Fifteen invariant families run; the load-bearing one is
I2, which fails the build if any foreign key in tenant A points at a row in
tenant B. That is the fixture-level analogue of NFR-QA-020 — without it, an
isolation test can pass for the wrong reason.

---

## What the fixture contains

Three tenants, two academic years each (2024/2025 closed, 2025/2026 with Term 1
closed, Term 2 active, Term 3 planned), on the Ghanaian three-term calendar.
`--as-of` defaults to `2026-02-18`, chosen so a closed, an active and a planned
term all exist at once; a fixture generated between academic years silently skips
every in-term code path.

| Tenant | Plan | Shape | Status |
|---|---|---|---|
| `sunrise` | Ketewese | 1 school, 1 campus | active |
| `brightfuture` | Ebom | 2 schools, 3 campuses | active |
| `mountzion` | Ketewese | 1 school, 1 campus, half size | suspended, 2 overdue platform invoices |

### The edge cases it deliberately carries

The happy path is easy to generate and tests almost nothing. `pnpm report`
prints the row IDs for each of these so a reviewer can open the fixture and look
rather than take the claim on trust.

| Case | Requirement |
|---|---|
| A student with two guardian links, and a guardian with four children | FR-STU-020 — **unresolved**, see below |
| Same student, same day, two staff, two different marks, conflict left open | FR-ATT-011 |
| Attendance correction that retains the original row rather than updating it | FR-ATT-030 |
| Offline-captured rows with `synced_at = NULL`, sitting in the queue | FR-UX-020, FR-UX-030 |
| Assessment weights totalling 97%, and a result set blocked because of it | FR-ASM-010, FR-RES-020 |
| A published result revised — v1 superseded, both versions retrievable | FR-RES-030 |
| A reversal as a negative correcting entry, requester ≠ approver | FR-FIN-020 |
| A confirmed payment with no allocation rows: unallocated credit | Ch 24.1, §8.5 |
| A settlement short by exactly the provider fee — correct, not a discrepancy | FR-FIN-030 |
| Unmatched-provider, unmatched-internal and disputed settlement lines | FR-FIN-030 |
| A mid-term joiner billed pro rata (44 of 58 school days) | FR-FEE-030 |
| A campus transfer inside one academic year: two enrolments, same year | FR-STU-030, TEN-013 |
| A transferred-out student who left owing fees | Ch 24.1 |
| A guardian who withdrew SMS consent, and a send suppressed because of it | DP-070 |
| A data subject request at day 27 of 30 | DP-030, DP-090 |
| A restricted health record an accountant must not see | FR-OPS-030 |
| Five login accounts that must each fail differently — see Logins below | Ch 13 |
| One email address deliberately reused across two tenants | TEN-012 |
| Platform impersonation written into the *tenant-visible* audit log | TEN-022 |


---

## Logins

Every seeded person who should be able to log in has an account, and
`fixtures/<profile>/CREDENTIALS.md` is generated from the graph so it cannot
drift from what was actually emitted.

Identity is a **separate row from the person**. Collapsing the two means a
guardian cannot exist before they activate an account, a departed teacher cannot
be disabled without deleting their marking history, and nobody can hold two
identities. All three come up in a real school inside the first term.

| Surface | Who | How they authenticate |
|---|---|---|
| Staff Console | proprietor, head, accountant, coordinator, admissions, health officer | email + password; MFA on money roles |
| Teacher Field App | class and subject teachers | email + password, role scoped to specific class ids |
| Parent View | guardians | phone + OTP, or a signed access link — no password |
| Student | JHS pupils only | admission number + password, `must_change_password` set |
| Platform Console | PBSMS staff | email + password, MFA mandatory, no `tenant_id` |

Guardians get no password on purpose. Someone on a low-cost Android arriving from
a WhatsApp link has a phone number and may well not have a working email address;
forcing a password on them is how the Parent View ends up unused. The link is the
credential, so `access_links` is a real table with an expiry and a single-use
flag, seeded in all three states — live, expired, already consumed.

Students below JHS get no account at all. A fixture that gives a Nursery 1 pupil
a login will not catch the code that assumes they have one.

### Accounts that should not simply work

The happy-path login proves almost nothing, so the fixture seeds five that must
each fail differently:

| Probe | Expected behaviour |
|---|---|
| `locked_account` | Correct password still refused while `locked_until` is in the future |
| `never_activated` | Invited, no hash exists. Must fail differently from a wrong password, and the invitation token must still work |
| `departed_staff` | Disabled. Login refused, but their ~500 score entries stay attributed to them |
| `conflict_of_interest` | Holds accountant **and** headmaster. FR-FIN-020's four-eyes rule must refuse them as their own approver |
| `email_reused_across_tenants` | `shared.principal@example.gh` exists in two tenants |

That last one is the sharpest. If the unique index on `login_email` is global
rather than `(tenant_id, login_email)`, **loading the fixture fails there** — and
that failure is the finding. A shared address is ordinary in this market: one
proprietor runs two schools, or a teacher moonlights at a second.

The suspended tenant also holds 27 accounts with entirely valid credentials.
Login must refuse them on subscription state, not on the credentials. Those are
different rejections and they belong in different code.

Password reset tokens are seeded live, expired and consumed. So are the parent
access links.

### Hashing

```bash
pnpm seed -- --hash scrypt   # default: fixture-grade scrypt, Node core, no deps
pnpm seed -- --hash none     # plain:<password>, rehash on load
```

**The hashing in `credentials.ts` is deliberately unsafe and would be a serious
defect in a real auth service.** Salts are derived from the password rather than
random, because a random salt would change every run and break the determinism
the whole package rests on — which also means identical passwords produce
identical hashes, exactly what salting exists to prevent. And the passwords are
published. Both are fine for a database nobody outside the team can reach and
fatal for one anybody can. The guard is operational, not technical: never point
this generator at an environment holding real people's data.

scrypt is used only because it ships in Node core. It is almost certainly not
your production KDF, so the algorithm is recorded per row in `password_algo`
rather than assumed. If your auth service owns hashing, use `--hash none`: the
generator writes `plain:<password>` and a stray plaintext row is trivially
greppable if one ever escapes.

---

## The FR-STU-020 question

The SRS specifies guardian↔student as many-to-many. Your stated rule is
one-to-many. This generator does not decide it — it makes the decision testable:

```bash
pnpm seed -- --cardinality many_to_many   # emits a student with two guardians
pnpm seed -- --cardinality one_to_many    # emits at most one link per student
```

Run the suite both ways against the real schema. Under `many_to_many` the
fixture contains a probe row (`guardian_links.probe = 'guardian_cardinality'`);
if the schema enforces one-to-many, **loading it must fail on a unique
constraint**. That failure is the point. Let the schema refuse, rather than
amending FR-STU-020 on the strength of an argument.

Note the probe deliberately links a *different* guardian from the student's
existing primary. Linking the same guardian twice would trip the constraint for
a reason unrelated to the cardinality question, and the failure would be
misread.

---

## Loading paths

### SQL (fast, proves the policies)

`writers/sql.ts` emits per-tenant blocks wrapped in
`set_config('app.tenant_id', 'tnt_x', true)`. Platform tables — plans, tenants,
metering, platform invoices, impersonation grants — are written first, outside
any tenant context.

**Run this as a role that does not have BYPASSRLS.** That is half the value of
the file. If a policy's `WITH CHECK` is wrong, or a table was created without
`ENABLE ROW LEVEL SECURITY` and `FORCE`, seeding either fails or silently
succeeds where it shouldn't — and either outcome is information you want before
writing application code, not after.

Change `--session-var` if your policies read a different GUC than
`app.tenant_id`, and `TABLE_NAMES` in `writers/sql.ts` if your table names
differ. Do not change the generators to match the schema; change the mapping.

### Service layer (slower, proves the validation)

`SeedSink` in `writers/json.ts` is the adapter interface. Implement it against
the NestJS services and run the same graph through both paths. A row that SQL
accepts and the API rejects is a spec disagreement worth finding early.

```ts
import { build, loadThroughSink, DEFAULT_CONFIG } from '@pbsms/seed';

await loadThroughSink(build(DEFAULT_CONFIG), {
  withTenant: (id, fn) => tenantContext.run({ tenantId: id }, fn),
  insert: (table, rows) => db.insertBatch(table, rows),
});
```

---

## Profiles

| Profile | Shape | Rows | Use |
|---|---|---|---|
| `ci` | 4 levels, 1 stream, 12/class, 6 attendance days per term | ~22k | Every pull request. Smallest graph that still contains every edge case. |
| `dev` | full ladder, 2 streams, 26/class, 15 days | ~230k | What you develop against. |
| `volume` | full ladder, 3 streams, 38/class, every school day | ~1.1M | NFR-PERF-020 and the report-card batch budget (NFR-PERF-023). |

The `volume` graph is larger than V8 will hold in a single string, so hashing and
writing walk it row by row. Output is NDJSON rather than one JSON document — a
test that wants one tenant's students shouldn't parse hundreds of megabytes to
get them, and a line-oriented file diffs legibly when the generator changes.

---

## Wiring it into CI

```yaml
- name: Seed fixture gate
  run: |
    pnpm --filter @pbsms/seed check                    # invariants + determinism
    pnpm --filter @pbsms/seed check:one-to-many        # both cardinality modes build
    pnpm --filter @pbsms/seed report:ci                # exits 1 if an edge case vanished
```

`report` exiting non-zero is the guard against silent erosion. It is easy to
write a generator that claims to produce a reversed payment and quietly stops
producing one after a refactor.

The fingerprint in `fixtures/*/FINGERPRINT` is a change-detector, not a
correctness claim. If it moves, the graph moved; check the diff was intended.
Changing the traversal order in `graphChunks` invalidates every recorded
fingerprint, so don't do it casually.

---

## Known limitations

- **Locale realism is guesswork.** Names, districts, fee levels and the term
  calendar are plausible, not sourced from a real school. Have someone who has
  run a Ghanaian basic school look at the invoice amounts and the term dates
  before treating any of it as representative.
- **Not every SRS module is generated.** Library, transport, inventory, BECE
  registration, CSSPS placement, promotion runs and admissions applications have
  types-worth-of-shape but no generator yet. They were left out because none of
  them carries an edge case that would change a schema decision; add them when a
  screen needs them.
- **Assessment weighting is broken in every school.** The 97% probe fires per
  school rather than in exactly one, so there is currently no school with a
  clean weighting *and* a full result pipeline in the same tenant. If you need
  one, adjust the `breakWeights` condition in `generators/activity.ts`.
- **No session or refresh-token rows.** Login state is not modelled; the fixture
  seeds credentials, not sessions. Add them if you need to test expiry or
  revocation behaviour.
- **No NaCCA strand/indicator data.** Subjects carry a strand count only.
  Competency coverage reporting (DOM-020) has nothing to read yet.
- **Grading is a percentage band scale**, not the BECE 1–9 stanine. If internal
  grading should mirror BECE, `GRADE_BANDS` in `generators/activity.ts` is the
  one place to change.
