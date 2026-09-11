# FR-API-020: API Versioning & Deprecation Policy

**Status**: adopted policy document, formalizing FR-API-020 (SRS Chapter 32.1)
against what's actually built, the same category as
`docs/quality-assurance/NFR-QA-050-defect-severity-taxonomy.md` — policy,
not gated `pbsms-platform` application code.

## The requirement (FR-API-020, verbatim)

> The API is versioned (URI-prefixed, e.g. /v1/) with a published
> deprecation policy of a minimum 6 months' notice before a version is
> retired.

## What's already built: URI versioning

Every controller in `apps/api/src/modules/` is mounted under a literal
`v1/` prefix (`@Controller('v1/students')`, `@Controller('v1/finance')`,
etc.) — there is no unversioned route anywhere in the API. This half of
FR-API-020 has been true since the first controller was written; nothing
in this document changes it. What was missing was the second half: the
policy itself was never written down anywhere a consumer (or a future
`v2/`) could point to.

## The policy this document adopts

1. **Minimum notice**: a version is never retired less than **6 months**
   after its successor version ships and its deprecation is announced.
   The 6-month floor is the SRS's own number, not a local choice.
2. **Announcement is not private.** Deprecation of a version is recorded
   in this document (a dated entry under "Deprecation log" below) and in
   the response itself: every request to a deprecated version's routes
   MUST carry a `Deprecation` header (RFC 8594) naming the retirement
   date, once that mechanism exists (see "Not yet built" below).
3. **A version is retired, not silently changed.** A breaking change to
   request/response shape, auth, or semantics ships as a new version
   prefix (`v2/`); it never mutates `v1/`'s existing contract in place.
   Additive, backward-compatible changes (a new optional field, a new
   endpoint) do not require a new version and are not deprecations.
4. **Retirement removes the route**, not just the documentation — once
   the notice period elapses, calling a retired version's endpoint
   returns `410 Gone`, not a silent redirect or a soft-broken response.

## Not yet built, flagged rather than assumed

There is currently exactly one API version (`v1/`) and it has never been
deprecated, so nothing in this repository yet emits a `Deprecation`
header or a `410 Gone` response — there has been no occasion to. Building
that mechanism (a shared interceptor/guard reading a version's
deprecation metadata) is real `pbsms-platform` application code, gated
the same way any other Stage-4 implementation is
(`CLAUDE.md`'s "Internal Engineering Agent" authorization table) — this
document adopts the *policy* the mechanism will need to enforce once that
gate clears or a `v2/` becomes necessary, whichever comes first. Nothing
here should be read as claiming the enforcement mechanism already exists.

## Deprecation log

*(empty — `v1/` has not been deprecated)*
