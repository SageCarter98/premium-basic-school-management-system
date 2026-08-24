-- ============================================================================
-- product_feedback_clustering.sql
--
-- Not a migration — an operational runbook. Nothing here is run by
-- `npm run migrate`; these are queries for a human (the Engineering Lead)
-- to run directly against product_feedback (0046/0047) when deciding what
-- to build next. Requires 0047_product_feedback_clustering.sql applied
-- first (pg_trgm + the trigram index).
--
-- Connect as pbsms_platform (PLATFORM_DATABASE_URL) for the correct
-- least-privilege read grant, or as the owner role (MIGRATE_DATABASE_URL)
-- if that's what's on hand locally — both can read this table.
--
-- Real ceiling, stated once here rather than repeated at every query
-- below: neither technique here is true semantic understanding. Two
-- reports describing the same underlying bug in genuinely different
-- words ("the export button doesn't work" vs. "can't get my invoice as
-- a PDF") will NOT be linked by either query. What follows finds
-- near-duplicate phrasing and common vocabulary — a real, useful first
-- pass, not a complete one. See CLAUDE.md's rollout-stage note for the
-- same caveat in context.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Volume and reach per category (EC-101's "request volume... affected
--    tenant count" — the actual numbers, no clustering needed for this part).
-- ----------------------------------------------------------------------------
select
  category,
  count(*)                       as report_count,
  count(distinct tenant_ref)     as distinct_tenants,
  min(created_at)                as first_seen,
  max(created_at)                as last_seen
from product_feedback
group by category
order by report_count desc;

-- ----------------------------------------------------------------------------
-- 2. Affected roles per category (EC-101's "affected roles") — role_codes
--    is text[], unnest to count each role a reporter held, not just the
--    submission count.
-- ----------------------------------------------------------------------------
select
  category,
  unnest(role_codes) as role_code,
  count(*)            as report_count
from product_feedback
group by category, role_code
order by category, report_count desc;

-- ----------------------------------------------------------------------------
-- 3. Most common words per category (Postgres's built-in full-text
--    statistics — ts_stat over a plain to_tsvector, English config).
--    Surfaces recurring vocabulary; not a theme name, a starting point
--    for reading the actual reports that use that word.
-- ----------------------------------------------------------------------------
select word, ndoc as reports_containing, nentry as total_occurrences
from ts_stat($q$
  select to_tsvector('english', subject || ' ' || message)
  from product_feedback
  where category = 'bug'
$q$)
order by ndoc desc
limit 25;
-- Swap 'bug' for 'feature_request' or 'other' to run against those.

-- ----------------------------------------------------------------------------
-- 4. Near-duplicate reports within a category (pg_trgm similarity on the
--    combined subject+message text). Pairs above the threshold are
--    candidates for "this is the same underlying issue, reported more
--    than once" — read them together, don't trust the score alone.
--    0.3 is a starting threshold, not a derived one; raise it if too
--    noisy, lower it if it's missing obvious duplicates.
-- ----------------------------------------------------------------------------
select
  a.id as report_a, a.subject as subject_a,
  b.id as report_b, b.subject as subject_b,
  similarity(a.subject || ' ' || a.message, b.subject || ' ' || b.message) as sim
from product_feedback a
join product_feedback b
  on a.category = b.category
  and a.id < b.id
  and similarity(a.subject || ' ' || a.message, b.subject || ' ' || b.message) > 0.3
order by sim desc
limit 50;

-- ----------------------------------------------------------------------------
-- 5. Connected groups, not just pairs — for a report that near-matches
--    several others, this collapses the pairwise results from #4 into
--    one row per report showing everything it clusters with. Still not
--    a "theme," just fewer rows to read than the raw pairwise list.
-- ----------------------------------------------------------------------------
select
  a.id,
  a.category,
  a.subject,
  count(*) as similar_report_count,
  array_agg(b.id order by similarity(a.subject || ' ' || a.message, b.subject || ' ' || b.message) desc) as similar_to
from product_feedback a
join product_feedback b
  on a.category = b.category
  and a.id <> b.id
  and similarity(a.subject || ' ' || a.message, b.subject || ' ' || b.message) > 0.3
group by a.id, a.category, a.subject
having count(*) > 0
order by similar_report_count desc;
