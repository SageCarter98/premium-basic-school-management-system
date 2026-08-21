-- ============================================================================
-- 0039_class_teacher.sql
--
-- Closes a gap 0020_teacher_assignments.sql's own header flagged from the
-- start: "no is_class_teacher" — Chapter 21.1's "Class Teacher" (a
-- class-level homeroom role, distinct from a class+subject assignment).
-- Purely additive on the existing teacher_assignments table (NFR-DEP-030),
-- same shape as this migration series' other additive columns
-- (assessment_components.indicator_id, periods.period_type).
--
-- is_class_teacher is a flag on an ORDINARY teacher_assignments row, not
-- a new table — a class teacher is still, structurally, one of a
-- teacher's class+subject assignments, just additionally marked as the
-- homeroom one. The new partial unique index enforces "at most one ACTIVE
-- class teacher per class+academic_year," independent of and orthogonal
-- to uq_teacher_assignments_active_slot (which is keyed by
-- class+subject+year) — a class teacher can simultaneously hold that
-- distinction on any one of their subject assignments to the class, and
-- ending that specific assignment (end()) also ends their class-teacher
-- standing, same "no separate lifecycle to keep in sync" reasoning as
-- every other single-column flag in this schema.
-- ============================================================================

alter table teacher_assignments add column is_class_teacher boolean not null default false;

create unique index uq_teacher_assignments_active_class_teacher
  on teacher_assignments (tenant_id, class_id, academic_year_id)
  where is_class_teacher and status = 'active';
