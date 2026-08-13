-- ============================================================================
-- 0018_staff_directory.sql
--
-- Implements the "real staff/role directory" gap noted throughout this
-- codebase's history (README's deferred-items list, multiple module
-- headers): every actor-identity column across the entire schema —
-- created_by/updated_by/deleted_by and every workflow-specific variant
-- (reviewed_by, approved_by, issued_by, decided_by, author_user_id,
-- etc.) — had ZERO foreign key constraint anywhere. Verified before
-- writing this migration: zero hits for "references users" across
-- infra/migrations/*.sql except tenant_users.user_id itself.
--
-- These 131 constraints all reference users(id) directly, NOT a
-- tenant-scoped composite key — same reasoning as tenant_users.user_id's
-- own existing FK. The actor was a real system user (login already
-- proves that); which tenant they were acting in is enforced by
-- RLS/RolesGuard at write time, not by this FK. A composite
-- (tenant_id, user_id) target isn't available anyway: tenant_users'
-- uniqueness is (tenant_id, user_id, role_code), since one user can hold
-- multiple roles in a tenant — a plain (tenant_id, user_id) unique index
-- would break on a user's 2nd role.
--
-- Deliberately NOT covered here: the polymorphic recipient_id/
-- issued_to_id columns (communication/discipline/health's recipient_type
-- in ('guardian','staff','student'), inventory's issued_to_type in
-- ('student','staff')). Postgres has no native conditional FK, and
-- 'guardian' still isn't a real table (a separate, already-documented
-- gap) — a single FK can't span three different possible target tables
-- anyway. Those get application-level validation instead (see
-- staff.service.ts and the services that call it), the conventional
-- answer to polymorphic associations in every framework that has them,
-- not a workaround unique to this codebase.
--
-- All 131 statements below were generated from the actual current schema
-- (grepped, not hand-typed) specifically to avoid a transcription error
-- silently missing or misspelling a column across 19 tables.
-- ============================================================================

alter table academic_years add constraint academic_years_created_by_fkey foreign key (created_by) references users(id);
alter table academic_years add constraint academic_years_deleted_by_fkey foreign key (deleted_by) references users(id);
alter table academic_years add constraint academic_years_updated_by_fkey foreign key (updated_by) references users(id);
alter table applicants add constraint applicants_created_by_fkey foreign key (created_by) references users(id);
alter table applicants add constraint applicants_deleted_by_fkey foreign key (deleted_by) references users(id);
alter table applicants add constraint applicants_updated_by_fkey foreign key (updated_by) references users(id);
alter table assessment_components add constraint assessment_components_created_by_fkey foreign key (created_by) references users(id);
alter table assessment_components add constraint assessment_components_updated_by_fkey foreign key (updated_by) references users(id);
alter table assessment_structures add constraint assessment_structures_created_by_fkey foreign key (created_by) references users(id);
alter table assessment_structures add constraint assessment_structures_deleted_by_fkey foreign key (deleted_by) references users(id);
alter table assessment_structures add constraint assessment_structures_reopened_by_fkey foreign key (reopened_by) references users(id);
alter table assessment_structures add constraint assessment_structures_updated_by_fkey foreign key (updated_by) references users(id);
alter table attendance_conflicts add constraint attendance_conflicts_incoming_submitted_by_fkey foreign key (incoming_submitted_by) references users(id);
alter table attendance_conflicts add constraint attendance_conflicts_resolved_by_fkey foreign key (resolved_by) references users(id);
alter table attendance_records add constraint attendance_records_corrected_by_fkey foreign key (corrected_by) references users(id);
alter table attendance_records add constraint attendance_records_created_by_fkey foreign key (created_by) references users(id);
alter table attendance_records add constraint attendance_records_deleted_by_fkey foreign key (deleted_by) references users(id);
alter table attendance_records add constraint attendance_records_updated_by_fkey foreign key (updated_by) references users(id);
alter table audit_log add constraint audit_log_actor_user_id_fkey foreign key (actor_user_id) references users(id);
alter table campuses add constraint campuses_created_by_fkey foreign key (created_by) references users(id);
alter table campuses add constraint campuses_deleted_by_fkey foreign key (deleted_by) references users(id);
alter table campuses add constraint campuses_updated_by_fkey foreign key (updated_by) references users(id);
alter table classes add constraint classes_created_by_fkey foreign key (created_by) references users(id);
alter table classes add constraint classes_deleted_by_fkey foreign key (deleted_by) references users(id);
alter table classes add constraint classes_updated_by_fkey foreign key (updated_by) references users(id);
alter table communication_preferences add constraint communication_preferences_created_by_fkey foreign key (created_by) references users(id);
alter table communication_preferences add constraint communication_preferences_updated_by_fkey foreign key (updated_by) references users(id);
alter table discipline_appeals add constraint discipline_appeals_created_by_fkey foreign key (created_by) references users(id);
alter table discipline_appeals add constraint discipline_appeals_decided_by_fkey foreign key (decided_by) references users(id);
alter table discipline_appeals add constraint discipline_appeals_raised_by_fkey foreign key (raised_by) references users(id);
alter table discipline_appeals add constraint discipline_appeals_updated_by_fkey foreign key (updated_by) references users(id);
alter table discipline_case_notes add constraint discipline_case_notes_author_user_id_fkey foreign key (author_user_id) references users(id);
alter table discipline_case_responses add constraint discipline_case_responses_created_by_fkey foreign key (created_by) references users(id);
alter table discipline_cases add constraint discipline_cases_created_by_fkey foreign key (created_by) references users(id);
alter table discipline_cases add constraint discipline_cases_reported_by_fkey foreign key (reported_by) references users(id);
alter table discipline_cases add constraint discipline_cases_updated_by_fkey foreign key (updated_by) references users(id);
alter table discipline_guardian_contacts add constraint discipline_guardian_contacts_created_by_fkey foreign key (created_by) references users(id);
alter table discipline_recognitions add constraint discipline_recognitions_awarded_by_fkey foreign key (awarded_by) references users(id);
alter table discipline_recognitions add constraint discipline_recognitions_created_by_fkey foreign key (created_by) references users(id);
alter table discipline_recognitions add constraint discipline_recognitions_updated_by_fkey foreign key (updated_by) references users(id);
alter table enrolments add constraint enrolments_created_by_fkey foreign key (created_by) references users(id);
alter table enrolments add constraint enrolments_deleted_by_fkey foreign key (deleted_by) references users(id);
alter table enrolments add constraint enrolments_updated_by_fkey foreign key (updated_by) references users(id);
alter table fee_instalments add constraint fee_instalments_created_by_fkey foreign key (created_by) references users(id);
alter table fee_structure_items add constraint fee_structure_items_created_by_fkey foreign key (created_by) references users(id);
alter table fee_structures add constraint fee_structures_created_by_fkey foreign key (created_by) references users(id);
alter table fee_structures add constraint fee_structures_updated_by_fkey foreign key (updated_by) references users(id);
alter table financial_assistance add constraint financial_assistance_approved_by_fkey foreign key (approved_by) references users(id);
alter table financial_assistance add constraint financial_assistance_created_by_fkey foreign key (created_by) references users(id);
alter table financial_assistance add constraint financial_assistance_first_approved_by_fkey foreign key (first_approved_by) references users(id);
alter table financial_assistance add constraint financial_assistance_rejected_by_fkey foreign key (rejected_by) references users(id);
alter table financial_assistance add constraint financial_assistance_requested_by_fkey foreign key (requested_by) references users(id);
alter table financial_assistance add constraint financial_assistance_updated_by_fkey foreign key (updated_by) references users(id);
alter table generated_documents add constraint generated_documents_generated_by_fkey foreign key (generated_by) references users(id);
alter table generated_documents add constraint generated_documents_revoked_by_fkey foreign key (revoked_by) references users(id);
alter table grading_policies add constraint grading_policies_created_by_fkey foreign key (created_by) references users(id);
alter table grading_policies add constraint grading_policies_updated_by_fkey foreign key (updated_by) references users(id);
alter table grading_scale_items add constraint grading_scale_items_created_by_fkey foreign key (created_by) references users(id);
alter table grading_scale_items add constraint grading_scale_items_updated_by_fkey foreign key (updated_by) references users(id);
alter table health_incident_guardian_contacts add constraint health_incident_guardian_contacts_created_by_fkey foreign key (created_by) references users(id);
alter table health_incidents add constraint health_incidents_created_by_fkey foreign key (created_by) references users(id);
alter table health_incidents add constraint health_incidents_updated_by_fkey foreign key (updated_by) references users(id);
alter table health_records add constraint health_records_created_by_fkey foreign key (created_by) references users(id);
alter table health_records add constraint health_records_updated_by_fkey foreign key (updated_by) references users(id);
alter table inventory_issuances add constraint inventory_issuances_issued_by_fkey foreign key (issued_by) references users(id);
alter table inventory_items add constraint inventory_items_created_by_fkey foreign key (created_by) references users(id);
alter table inventory_items add constraint inventory_items_updated_by_fkey foreign key (updated_by) references users(id);
alter table invoices add constraint invoices_created_by_fkey foreign key (created_by) references users(id);
alter table invoices add constraint invoices_issued_by_fkey foreign key (issued_by) references users(id);
alter table invoices add constraint invoices_updated_by_fkey foreign key (updated_by) references users(id);
alter table library_items add constraint library_items_created_by_fkey foreign key (created_by) references users(id);
alter table library_items add constraint library_items_updated_by_fkey foreign key (updated_by) references users(id);
alter table library_loans add constraint library_loans_created_by_fkey foreign key (created_by) references users(id);
alter table library_loans add constraint library_loans_updated_by_fkey foreign key (updated_by) references users(id);
alter table library_members add constraint library_members_created_by_fkey foreign key (created_by) references users(id);
alter table medication_administration_log add constraint medication_administration_log_administered_by_fkey foreign key (administered_by) references users(id);
alter table notification_report_comments add constraint notification_report_comments_author_user_id_fkey foreign key (author_user_id) references users(id);
alter table notification_reports add constraint notification_reports_assigned_by_fkey foreign key (assigned_by) references users(id);
alter table notification_reports add constraint notification_reports_created_by_fkey foreign key (created_by) references users(id);
alter table notification_reports add constraint notification_reports_updated_by_fkey foreign key (updated_by) references users(id);
alter table notification_templates add constraint notification_templates_created_by_fkey foreign key (created_by) references users(id);
alter table notification_templates add constraint notification_templates_updated_by_fkey foreign key (updated_by) references users(id);
alter table notifications add constraint notifications_created_by_fkey foreign key (created_by) references users(id);
alter table notifications add constraint notifications_updated_by_fkey foreign key (updated_by) references users(id);
alter table payment_allocations add constraint payment_allocations_created_by_fkey foreign key (created_by) references users(id);
alter table payments add constraint payments_created_by_fkey foreign key (created_by) references users(id);
alter table payments add constraint payments_received_by_fkey foreign key (received_by) references users(id);
alter table payments add constraint payments_updated_by_fkey foreign key (updated_by) references users(id);
alter table promotion_decisions add constraint promotion_decisions_applied_by_fkey foreign key (applied_by) references users(id);
alter table promotion_decisions add constraint promotion_decisions_created_by_fkey foreign key (created_by) references users(id);
alter table promotion_decisions add constraint promotion_decisions_decided_by_fkey foreign key (decided_by) references users(id);
alter table promotion_decisions add constraint promotion_decisions_updated_by_fkey foreign key (updated_by) references users(id);
alter table result_candidates add constraint result_candidates_created_by_fkey foreign key (created_by) references users(id);
alter table reversals add constraint reversals_created_by_fkey foreign key (created_by) references users(id);
alter table schools add constraint schools_created_by_fkey foreign key (created_by) references users(id);
alter table schools add constraint schools_deleted_by_fkey foreign key (deleted_by) references users(id);
alter table schools add constraint schools_updated_by_fkey foreign key (updated_by) references users(id);
alter table scores add constraint scores_created_by_fkey foreign key (created_by) references users(id);
alter table scores add constraint scores_updated_by_fkey foreign key (updated_by) references users(id);
alter table student_results add constraint student_results_approved_by_fkey foreign key (approved_by) references users(id);
alter table student_results add constraint student_results_archived_by_fkey foreign key (archived_by) references users(id);
alter table student_results add constraint student_results_corrected_by_fkey foreign key (corrected_by) references users(id);
alter table student_results add constraint student_results_created_by_fkey foreign key (created_by) references users(id);
alter table student_results add constraint student_results_locked_by_fkey foreign key (locked_by) references users(id);
alter table student_results add constraint student_results_published_by_fkey foreign key (published_by) references users(id);
alter table student_results add constraint student_results_reopened_by_fkey foreign key (reopened_by) references users(id);
alter table student_results add constraint student_results_returned_by_fkey foreign key (returned_by) references users(id);
alter table student_results add constraint student_results_reviewed_by_fkey foreign key (reviewed_by) references users(id);
alter table student_results add constraint student_results_submitted_by_fkey foreign key (submitted_by) references users(id);
alter table student_results add constraint student_results_updated_by_fkey foreign key (updated_by) references users(id);
alter table students add constraint students_created_by_fkey foreign key (created_by) references users(id);
alter table students add constraint students_deleted_by_fkey foreign key (deleted_by) references users(id);
alter table students add constraint students_updated_by_fkey foreign key (updated_by) references users(id);
alter table subjects add constraint subjects_created_by_fkey foreign key (created_by) references users(id);
alter table subjects add constraint subjects_deleted_by_fkey foreign key (deleted_by) references users(id);
alter table subjects add constraint subjects_updated_by_fkey foreign key (updated_by) references users(id);
alter table tenant_branding add constraint tenant_branding_created_by_fkey foreign key (created_by) references users(id);
alter table tenant_branding add constraint tenant_branding_updated_by_fkey foreign key (updated_by) references users(id);
alter table tenant_communication_settings add constraint tenant_communication_settings_created_by_fkey foreign key (created_by) references users(id);
alter table tenant_communication_settings add constraint tenant_communication_settings_updated_by_fkey foreign key (updated_by) references users(id);
alter table tenant_users add constraint tenant_users_created_by_fkey foreign key (created_by) references users(id);
alter table tenant_users add constraint tenant_users_updated_by_fkey foreign key (updated_by) references users(id);
alter table transport_drivers add constraint transport_drivers_created_by_fkey foreign key (created_by) references users(id);
alter table transport_drivers add constraint transport_drivers_updated_by_fkey foreign key (updated_by) references users(id);
alter table transport_routes add constraint transport_routes_created_by_fkey foreign key (created_by) references users(id);
alter table transport_routes add constraint transport_routes_updated_by_fkey foreign key (updated_by) references users(id);
alter table transport_stops add constraint transport_stops_created_by_fkey foreign key (created_by) references users(id);
alter table transport_student_assignments add constraint transport_student_assignments_created_by_fkey foreign key (created_by) references users(id);
alter table transport_student_assignments add constraint transport_student_assignments_updated_by_fkey foreign key (updated_by) references users(id);
alter table transport_vehicles add constraint transport_vehicles_created_by_fkey foreign key (created_by) references users(id);
alter table transport_vehicles add constraint transport_vehicles_updated_by_fkey foreign key (updated_by) references users(id);

-- ----------------------------------------------------------------------------
-- Sanity check: after this file runs, every *_by/author_user_id/
-- actor_user_id column in the schema should have a FK to users(id). Spot
-- check with:
-- SELECT conrelid::regclass AS table_name, conname
-- FROM pg_constraint
-- WHERE confrelid = 'users'::regclass AND contype = 'f'
-- ORDER BY 1;
-- -- should return 131 rows (one per statement above), covering every
-- -- table listed.
-- ----------------------------------------------------------------------------
