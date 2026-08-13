-- ============================================================================
-- 0017_score_optimistic_locking.sql
--
-- Implements SRS v2.1 Chapter 37.4, NFR-PERF-030: "concurrent score entry
-- by two teachers for the same class subject is resolved by field-level
-- optimistic locking with a clear conflict message identifying the other
-- editor, never a silent last-write-wins on the whole record."
--
-- Found during Phase 4 hardening: assessment.service.ts's upsertScore()
-- was a plain `INSERT ... ON CONFLICT DO UPDATE` with no version check at
-- all — exactly the silent last-write-wins this requirement prohibits.
-- Not a performance gap Phase 4's load-testing would have caught; a
-- correctness gap that happened to live in the "Performance, Scalability,
-- Reliability" chapter.
--
-- Scope: `scores` only. NFR-PERF-030 names score entry specifically;
-- extending optimistic locking to every other concurrently-editable table
-- in this codebase (fee structures, grading policies, etc.) is a
-- separate, broader piece of work the SRS doesn't ask for here.
-- ============================================================================

alter table scores add column version integer not null default 1;

-- ----------------------------------------------------------------------------
-- No RLS/grant changes needed — scores already has both from 0004_assessment.sql;
-- this is an ordinary column addition to an existing tenant-owned table.
-- ----------------------------------------------------------------------------
