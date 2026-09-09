# NFR-QA-050: Defect Severity Taxonomy

**Status**: adopted policy document, not an SRS chapter. Formalizes NFR-QA-050
so the definition exists somewhere other than as prose inside the SRS PDF,
and so it can be enforced (the actual enforcement is the severity dropdown in
`.github/ISSUE_TEMPLATE/defect_report.yml`, which uses this taxonomy verbatim
as its options).

## Why this exists now

This is one of two prerequisite pieces for the Internal Engineering Agent's
own Stage-4 gate (`docs/internal-engineering-agent/PBSMS_Internal_Engineering_Agent_v2_1.pdf`,
§9 "Metrics" and §13 "Open Questions"). That document names **"defect escape
rate, Agent vs human PRs"** as the metric EC-700's suspension condition
compares against — and states plainly that no baseline exists yet, that
establishing one is a stage-4 prerequisite, and that it takes at least a
quarter of ordinary development to produce. Two things have to exist before
that quarter can even start being measured meaningfully:

1. A shared definition of what counts as a "defect" and at what severity
   (this document, and NFR-QA-050 itself).
2. A place to record one when it's found (the defect-register issue
   template this document accompanies).

Neither of those is gated implementation work — they're policy and
configuration, the same category as the existing CI-gate tooling (EC-500 to
EC-507) that was cleared to build immediately regardless of Stage 4. **This
document does not start the measurement quarter itself** — that still needs
the Engineering Lead to decide when a genuinely human-authored body of
development work is happening to measure against (see the open question
below).

## The taxonomy (NFR-QA-050, verbatim)

> Defect severities — Critical (security, financial integrity, data loss,
> cross-tenant leak, total outage), High (major workflow unavailable,
> official result incorrect), Medium (important impairment with
> workaround), Low (minor usability/presentation). Critical and High
> defects block release.

| Severity | Definition | Blocks release? |
|---|---|---|
| **Critical** | Security vulnerability, financial-integrity break, data loss, a cross-tenant data leak, or a total outage | Yes |
| **High** | A major workflow is unavailable, or an official result (a published grade, a report card, an invoice) is incorrect | Yes |
| **Medium** | An important impairment that has a workaround | No |
| **Low** | A minor usability or presentation issue | No |

## What counts as "escaped"

A defect is "escaped" for this register's purposes when it was found **after**
the change that introduced it had already merged to `main` — not something
caught in code review or CI before merge. That's a deliberate, narrow scope:
this register exists specifically to produce EC-700's numerator (defects that
got past the gates), not to be a general bug tracker for pre-merge review
comments.

## Open question this does not resolve

`PBSMS_Internal_Engineering_Agent_v2_1.pdf` §13 also names the real blocker
directly: the baseline needs "at least a quarter of **ordinary development**"
to produce — meaning a body of genuinely human-authored, human-reviewed
merged changes large enough to measure a defect-escape rate against. As of
this document's own creation (2026-09-09), essentially all PR activity in
this repository's git history since governance began (2026-08-24) is either
Agent-authored work inside an already-cleared category (EC-100/101/102/107,
test authoring) or predates the framework entirely as direct commits. There
is currently no naturally-occurring population of human-only merged PRs to
draw a baseline from — that population has to be produced deliberately (a
second engineer joining and working the normal PR pipeline, or the current
Engineering Lead doing a stretch of hands-on-keyboard work through the same
pipeline), not assumed to accumulate on its own. Deciding when and how that
measurement period runs is the Engineering Lead's call, per §8's
accountability table ("Engineering Lead... invoking EC-700") — this document
only makes sure that once it starts, there's a shared severity definition and
a place to record what's found.
