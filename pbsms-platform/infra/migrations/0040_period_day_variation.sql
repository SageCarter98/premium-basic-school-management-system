-- ============================================================================
-- 0040_period_day_variation.sql
--
-- Closes a flagged gap: 0033_timetable.sql's periods table applied one
-- universal (start_time, end_time) per period across every day_of_week a
-- class meets at that slot — no way to represent a school's shorter
-- Friday schedule (or any other day-specific variation) without editing
-- the shared time for every day.
--
-- Additive nullable column, same "genuinely additive, no backfill risk"
-- posture as period_type/indicator_id before it: day_of_week is NULL by
-- default (existing rows, and any tenant that never needs day variation,
-- are unaffected — "applies to every day," the same behaviour as before
-- this migration). A tenant that wants a different Friday schedule
-- creates a SECOND periods row with the same name/sequence but
-- day_of_week = 'friday' and its own times; timetable.service.ts's
-- createEntry() (unchanged logic, see its own header) already keys a
-- timetable_entries row on a specific period_id, so a day-specific period
-- is simply a different row to pick — no schema change needed on
-- timetable_entries itself, and FR-ACA-040's existing conflict-detection
-- partial unique indexes need no change either (still keyed on period_id
-- directly). createEntry() gains ONE new pre-check: a day-specific
-- period can only back an entry on that same day (a Friday-only period
-- assigned to a Monday entry would be silently wrong data otherwise).
-- ============================================================================

alter table periods add column day_of_week text
  check (day_of_week is null or day_of_week in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'));
