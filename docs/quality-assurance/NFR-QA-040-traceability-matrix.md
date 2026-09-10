# NFR-QA-040: Requirement Traceability Matrix

**Status**: adopted policy + tooling, not an SRS chapter. Formalizes how
NFR-QA-040 is satisfied in this repository, and points at the actual
enforcement — `apps/api/tools/traceability-report.ts` (`npm run
traceability:report --workspace apps/api`) — rather than a hand-typed
matrix that would be stale the moment the next PR merges.

## The requirement (NFR-QA-040, verbatim)

> Every requirement ID in this document (Appendix A) MUST map to design,
> implementation, database change, API, permission rule, automated test
> and acceptance evidence before the owning chapter is marked complete.

## Why a re-runnable report, not a static matrix

A 116-row-by-7-column matrix typed out once and committed would be wrong
within days — this repository already has direct, first-hand evidence of
exactly that failure mode. `CLAUDE.md`'s own "2026-08-27 documentation
drift" note records that `detect-spec-gaps.ts`'s CI-gates table claimed
several checks were "not built" days after they'd actually shipped, simply
because nobody re-ran the comparison before writing the claim down. A
traceability matrix is the same shape of artifact, at ten times the size —
committing one as static prose would guarantee it goes stale faster than
anyone would notice.

`traceability-report.ts` instead extends `detect-spec-gaps.ts` (EC-107,
already cleared regardless of the Stage-4 implementation gate — this is
requirement-tracing tooling, not PBSMS product code) with three more
automated columns:

| Column | How it's detected |
|---|---|
| **impl** (implementation) | Any reference to the ID anywhere in the scanned implementation directories — `detect-spec-gaps.ts`'s own definition |
| **test** | The referencing file matches `detect-spec-gaps.ts`'s test-file shape (`apps/api/test/`, `*.spec.ts`/`*.test.ts(x)`, `__tests__/`) |
| **db** (database change) | A referencing file lives under `infra/migrations/` |
| **api** | A referencing file contains an `@Controller(` decorator |
| **perm** (permission rule) | A referencing file contains a `@Roles(` decorator |

## The two columns this cannot honestly automate

NFR-QA-040 names seven categories. Two of them — **design** and
**acceptance evidence** — have no automatable signal in source text, and
`traceability-report.ts` does not report a Y/N for either. A design
rationale can live in a code comment, a standalone spec document, or
nowhere at all; grepping for its presence would be guessing. Acceptance
evidence is a human sign-off — the PM/SDLC tracker's own gate-decision
mechanism exists specifically because that decision belongs to a named
accountable person, never to a script. Printing a confident-looking Y/N
for either column would be exactly the "falsified evidence" failure mode
`CLAUDE.md`'s own backfill-verification section warns against — so the
report omits them rather than fabricates them. Confirming design intent
and acceptance sign-off for a given requirement is still a real, necessary
step; it's just not this tool's step.

## What the automated columns are, and are not, evidence of

- **impl + test** are `detect-spec-gaps.ts`'s own two columns, unchanged.
  As of this document's creation, 91/116 SRS IDs have both.
- **db/api/perm** are additional signal, not a stricter bar. A
  requirement can legitimately have none of the three — a pure
  business-rule or NFR with no migration, no new endpoint, and no
  role-gated route of its own — without that being a gap. Read a `N` in
  those columns as "nothing detected," not "missing."
- All five automated columns share `detect-spec-gaps.ts`'s own documented
  limitation: a plain substring/file-content match, deliberately loose
  (trading false positives for not missing a real reference), and scoped
  to the same fixed set of directories. A reference living somewhere that
  list doesn't cover — as already happened once this session with a
  frontend implementation the original scan list didn't include — will
  read as absent even when real work exists.
