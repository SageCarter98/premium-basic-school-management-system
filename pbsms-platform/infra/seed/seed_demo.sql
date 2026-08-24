-- ============================================================================
-- seed_demo.sql
--
-- Creates two demo tenants so a developer can prove tenant isolation on
-- day one, by hand, before any application code exists. This is the fastest
-- way to build trust in the Chapter 1 architecture decision: run this, then
-- run the two SELECTs at the bottom and see isolation working for yourself.
-- ============================================================================

-- Pricing (0024_billing.sql) is ILLUSTRATIVE seed data only — Chapter
-- 5.1's own text: "confirm pricing with the business before build."
insert into plans (id, code, name, billing_basis, flat_fee_amount, per_student_rate, currency) values
  ('00000000-0000-0000-0000-000000000001', 'starter',  'Starter',  'flat', 500.00, null, 'GHS'),
  ('00000000-0000-0000-0000-000000000002', 'standard', 'Standard', 'per_active_student', null, 15.00, 'GHS');

-- Tenant A: a single small school (Starter tier)
insert into tenants (id, name, slug, status, plan_id, default_currency, default_timezone) values
  ('11111111-1111-1111-1111-111111111111', 'Sunrise Basic School', 'sunrise', 'active',
   '00000000-0000-0000-0000-000000000001', 'GHS', 'Africa/Accra');

-- Tenant B: a proprietor with a multi-school group (Standard tier) — this is
-- the tenant shape that a single-school design (v1.0 of the SRS) could never
-- represent, and it is deliberately included here for that reason.
insert into tenants (id, name, slug, status, plan_id, default_currency, default_timezone) values
  ('22222222-2222-2222-2222-222222222222', 'Golden Gate Schools Group', 'golden-gate', 'active',
   '00000000-0000-0000-0000-000000000002', 'GHS', 'Africa/Accra');

-- tenant_subscriptions (0024_billing.sql) — real active subscription rows
-- so TEN-031's GET /v1/billing/summary has data out of the box, without
-- first requiring a live assignPlan() call.
insert into tenant_subscriptions (id, tenant_id, plan_id, billing_cycle, current_period_start, current_period_end) values
  ('97000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000001', 'termly', current_date, current_date + interval '3 months'),
  ('97000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '00000000-0000-0000-0000-000000000002', 'termly', current_date, current_date + interval '3 months');

-- Demo login users. Password for all three is 'demo1234' — hashed with the
-- same argon2 defaults auth.module.ts verifies against (`npx argon2` via
-- the `argon2` package, not hand-rolled). Two admins (one per tenant) plus
-- a second Sunrise-tenant user (teacher@sunrise) exist specifically so the
-- FR-ATT-011 different-user attendance conflict can be demonstrated: two
-- users in the SAME tenant submitting for the same student/class/date/
-- session — a scenario RLS alone cannot exercise, since it only separates
-- different tenants.
--
-- Moved here (was originally seeded near the end of this file, after
-- everything that references created_by/updated_by/etc.) once
-- 0018_staff_directory.sql added FK constraints from ~130 actor-identity
-- columns to users(id) — a fresh migrate+seed run now fails at the very
-- first created_by reference (attendance_records) unless users/tenant_users
-- exist before anything else in this file does. Caught by actually running
-- a full schema reset + re-migrate + re-seed, not by inspection.
-- Platform Super Admin (Chapter 3.1, TEN-013): belongs to no tenant — no
-- tenant_users row for this id anywhere in this file, deliberately. Used
-- by tenant-lifecycle.e2e-spec.ts (0021_tenant_lifecycle.sql) to exercise
-- TenantsService as a real platform actor, and now (0022_platform_roles.sql,
-- Phase A2) a real platform_super_admin role grant so it's immediately
-- usable for live-HTTP testing of /v1/platform/* too.
insert into users (id, email, password_hash, full_name, is_platform_user) values
  ('99999999-0000-0000-0000-000000000005', 'platform-admin@pbsms.test',
   '$argon2id$v=19$m=19456,t=2,p=1$J8pMizkD8HfLcG7biD86Ig$SO/smxbJwwmFwoTMBlC8AtRLB9Ie8fCiOPO+pHG12Uw',
   'PBSMS Platform Admin', true);

insert into platform_user_roles (id, user_id, role_code, granted_by) values
  ('98000000-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000005',
   'platform_super_admin', '99999999-0000-0000-0000-000000000005');

insert into users (id, email, password_hash, full_name) values
  ('99999999-0000-0000-0000-000000000001', 'admin@sunrise.pbsms.test',
   '$argon2id$v=19$m=19456,t=2,p=1$J8pMizkD8HfLcG7biD86Ig$SO/smxbJwwmFwoTMBlC8AtRLB9Ie8fCiOPO+pHG12Uw',
   'Sunrise Admin'),
  ('99999999-0000-0000-0000-000000000002', 'admin@goldengate.pbsms.test',
   '$argon2id$v=19$m=19456,t=2,p=1$J8pMizkD8HfLcG7biD86Ig$SO/smxbJwwmFwoTMBlC8AtRLB9Ie8fCiOPO+pHG12Uw',
   'Golden Gate Admin'),
  ('99999999-0000-0000-0000-000000000003', 'teacher@sunrise.pbsms.test',
   '$argon2id$v=19$m=19456,t=2,p=1$J8pMizkD8HfLcG7biD86Ig$SO/smxbJwwmFwoTMBlC8AtRLB9Ie8fCiOPO+pHG12Uw',
   'Sunrise Teacher'),
  ('99999999-0000-0000-0000-000000000004', 'accountant@sunrise.pbsms.test',
   '$argon2id$v=19$m=19456,t=2,p=1$J8pMizkD8HfLcG7biD86Ig$SO/smxbJwwmFwoTMBlC8AtRLB9Ie8fCiOPO+pHG12Uw',
   'Sunrise Accountant'),
  -- Second Golden Gate user (0026_delegation.sql needs a real distinct
  -- recipient in the SAME tenant as its delegator — Golden Gate had only
  -- one seeded user, admin@goldengate, before this).
  ('99999999-0000-0000-0000-000000000010', 'teacher@goldengate.pbsms.test',
   '$argon2id$v=19$m=19456,t=2,p=1$J8pMizkD8HfLcG7biD86Ig$SO/smxbJwwmFwoTMBlC8AtRLB9Ie8fCiOPO+pHG12Uw',
   'Golden Gate Teacher'),
  -- Stage 8 (frontend): LIBRARY_TEAM/TRANSPORT_TEAM/HEALTH_TEAM/
  -- INVENTORY_TEAM are each [...LEADERSHIP, <specialist role>] — before
  -- this, the only way to exercise those 4 modules' actual tiers was the
  -- MFA-gated headmaster account, same reasoning as accountant@sunrise's
  -- own addition above (Authorization Pass 1) for making a role tier
  -- distinguishable via live-HTTP testing without needing MFA.
  ('99999999-0000-0000-0000-000000000006', 'librarian@sunrise.pbsms.test',
   '$argon2id$v=19$m=19456,t=2,p=1$J8pMizkD8HfLcG7biD86Ig$SO/smxbJwwmFwoTMBlC8AtRLB9Ie8fCiOPO+pHG12Uw',
   'Sunrise Librarian'),
  ('99999999-0000-0000-0000-000000000007', 'transport@sunrise.pbsms.test',
   '$argon2id$v=19$m=19456,t=2,p=1$J8pMizkD8HfLcG7biD86Ig$SO/smxbJwwmFwoTMBlC8AtRLB9Ie8fCiOPO+pHG12Uw',
   'Sunrise Transport Officer'),
  ('99999999-0000-0000-0000-000000000008', 'health@sunrise.pbsms.test',
   '$argon2id$v=19$m=19456,t=2,p=1$J8pMizkD8HfLcG7biD86Ig$SO/smxbJwwmFwoTMBlC8AtRLB9Ie8fCiOPO+pHG12Uw',
   'Sunrise Health Officer'),
  ('99999999-0000-0000-0000-000000000009', 'storekeeper@sunrise.pbsms.test',
   '$argon2id$v=19$m=19456,t=2,p=1$J8pMizkD8HfLcG7biD86Ig$SO/smxbJwwmFwoTMBlC8AtRLB9Ie8fCiOPO+pHG12Uw',
   'Sunrise Storekeeper');

-- Chapter 13/33 (authorization Pass 1): 'accountant' is a distinct,
-- lower-tier role from 'headmaster' specifically so RolesGuard's
-- read/record/approve tiers on Finance are actually exercisable — an
-- accountant can record a payment but not approve a reversal (Chapter
-- 33.3's "Cashier cannot approve own reversal", operationalized with the
-- role this codebase's role list actually has — see finance.controller.ts).
-- Fixed ids (not gen_random_uuid()) added so the isolation suite's
-- tenant_users describe block can do direct-id-lookup assertions, per
-- module-pattern rule 6 (see feedback_pbsms_module_pattern memory).
insert into tenant_users (id, tenant_id, user_id, role_code) values
  ('80000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000003', 'teacher'),
  ('80000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000001', 'headmaster'),
  ('80000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000004', 'accountant'),
  ('80000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', '99999999-0000-0000-0000-000000000002', 'proprietor'),
  ('80000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', '99999999-0000-0000-0000-000000000010', 'teacher'),
  ('80000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000006', 'librarian'),
  ('80000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000007', 'transport_officer'),
  ('80000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000008', 'health_officer'),
  ('80000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000009', 'storekeeper');

-- Schools
insert into schools (id, tenant_id, name, code) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Sunrise Basic School', 'SUN');

insert into schools (id, tenant_id, name, code) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Golden Gate — Nursery/KG Campus', 'GG-NKG'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Golden Gate — Primary/JHS Campus', 'GG-PJHS');

-- Academic years
insert into academic_years (id, tenant_id, school_id, name, status) values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', '2026/2027', 'active'),
  ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-0000-0000-0000-000000000002', '2026/2027', 'active');

-- Classes
insert into classes (id, tenant_id, academic_year_id, name, level) values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'cccccccc-0000-0000-0000-000000000001', 'JHS 2A', 'JHS 2'),
  ('dddddddd-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'cccccccc-0000-0000-0000-000000000002', 'JHS 3A', 'JHS 3');

-- Students — one per tenant, deliberately similar names, to make a leaked
-- cross-tenant row obvious rather than easy to miss during manual testing.
insert into students (id, tenant_id, school_id, admission_no, first_name, last_name, dob, gender) values
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'SUN-2026-001', 'Ama', 'Mensah', '2012-03-14', 'F');

insert into students (id, tenant_id, school_id, admission_no, first_name, last_name, dob, gender) values
  ('eeeeeeee-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-0000-0000-0000-000000000002', 'GG-2026-001', 'Ama', 'Owusu', '2011-11-02', 'F');

-- Guardians (0019_guardians.sql, FR-STU-020) — same contact details already
-- referenced by name/phone/email in the notifications/discipline_guardian_
-- contacts fixtures further down this file ("Ama Mensah's guardian" /
-- "Ama Owusu's guardian", guardian1@example.test / guardian2@example.test),
-- now backed by a real row instead of just free-text snapshot fields.
insert into guardians (id, tenant_id, full_name, phone, email, created_by, updated_by) values
  ('90000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Ama Mensah''s Guardian', '+233200000001', 'guardian1@example.test',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('90000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Ama Owusu''s Guardian', '+233200000002', 'guardian2@example.test',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into student_guardians
  (id, tenant_id, student_id, guardian_id, relationship, is_primary_contact,
   is_emergency_contact, can_pickup, has_finance_access, has_report_access,
   created_by, updated_by) values
  ('91111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'mother',
   true, true, true, true, true,
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('91111111-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000002', 'mother',
   true, true, true, true, true,
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- Stage 6 (Parent View, 0031_guardian_access.sql). token_hash is a fixed
-- fixture value, not a real sha256 of any actual token — this row exists
-- for the isolation suite's direct-id-lookup assertions, not for live
-- login (a real grant is always minted via POST /v1/guardians/:id/
-- access-links, which returns the one-time raw token itself).
insert into guardian_access_grants (id, tenant_id, guardian_id, token_hash, expires_at, created_by) values
  ('92222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '90000000-0000-0000-0000-000000000001', 'seed-fixture-hash-not-a-real-token-0000000000000000000000000001',
   now() + interval '90 days', '99999999-0000-0000-0000-000000000001');

-- Fixed ids (rather than letting gen_random_uuid() assign them) so the
-- tenant-isolation e2e suite can do a direct-id-lookup test against a known
-- row, the same way it already does for the Tenant A student above.
insert into enrolments (id, tenant_id, student_id, academic_year_id, class_id) values
  ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'eeeeeeee-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001'),
  ('ffffffff-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'eeeeeeee-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000002');

-- Applicants (0002_admissions.sql) — one per tenant, minimal draft state;
-- used by the isolation suite's "applicants" block. Conversion (FR-ADM-030)
-- is exercised live via curl, not seeded here, since it's a business-logic
-- test rather than an isolation test.
insert into applicants (id, tenant_id, school_id, first_name, last_name, status) values
  ('33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Kojo', 'Boateng', 'draft'),
  ('33333333-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-0000-0000-0000-000000000002', 'Kojo', 'Asante', 'draft');

-- Attendance records (0003_attendance.sql) — one per tenant, used by the
-- isolation suite's "attendance_records" block. created_by matches the
-- demo login users inserted below, since conflict resolution (FR-ATT-011)
-- depends on comparing the submitting user against created_by.
insert into attendance_records (id, tenant_id, student_id, class_id, attendance_date, status, created_by) values
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', current_date, 'present',
   '99999999-0000-0000-0000-000000000001'),
  ('44444444-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000002', current_date, 'present',
   '99999999-0000-0000-0000-000000000002');

-- Assessment (0004_assessment.sql) — one subject, one draft-but-
-- publish-ready structure (components already sum to 100), and one score
-- per tenant. Left in 'draft' status deliberately, same reasoning as the
-- applicants block above: publish() (FR-ASM-010) is exercised live via
-- curl, not seeded pre-published, since it's a business-logic test rather
-- than an isolation test. Fixed ids so the isolation e2e suite can do
-- direct-id-lookup tests against a known row, same pattern as every block
-- above.
insert into subjects (id, tenant_id, name, code) values
  ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mathematics', 'MATH'),
  ('55555555-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Mathematics', 'MATH');

insert into assessment_structures (id, tenant_id, class_id, subject_id, academic_year_id) values
  ('66666666-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'dddddddd-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001'),
  ('66666666-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'dddddddd-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000002');

-- Weights sum to exactly 100 per structure, so publish() can be exercised
-- successfully as-is, without first needing to fix up seed data.
insert into assessment_components (id, tenant_id, assessment_structure_id, component_type, weight, max_score) values
  ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '66666666-0000-0000-0000-000000000001', 'class_exercise', 40, 100),
  ('77777777-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '66666666-0000-0000-0000-000000000001', 'end_of_term_exam', 60, 100),
  ('77777777-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   '66666666-0000-0000-0000-000000000002', 'class_exercise', 40, 100),
  ('77777777-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   '66666666-0000-0000-0000-000000000002', 'end_of_term_exam', 60, 100);

insert into scores (id, tenant_id, assessment_component_id, student_id, value, status, created_by) values
  ('88888888-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '77777777-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 32, 'scored',
   '99999999-0000-0000-0000-000000000003'),
  ('88888888-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '77777777-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000002', 35, 'scored',
   '99999999-0000-0000-0000-000000000002');

-- The seeded assessment structures above only had a score for their
-- class_exercise component; grading's compute() (FR-GRA-060) refuses to
-- run against a class with any incomplete component, so a second score for
-- the end_of_term_exam component is added here purely so the grading demo
-- below has something complete to work with. class_exercise's score stays
-- the one seeded above (32/35) unchanged.
insert into scores (id, tenant_id, assessment_component_id, student_id, value, status, created_by) values
  ('88888888-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '77777777-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 70, 'scored',
   '99999999-0000-0000-0000-000000000003'),
  ('88888888-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   '77777777-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000002', 90, 'scored',
   '99999999-0000-0000-0000-000000000002');

-- Teacher assignments (0020_teacher_assignments.sql, Chapter 17.1 /
-- FR-ASM-020) — teacher@sunrise is actively assigned to Tenant A's
-- JHS 2A/Mathematics/2026-2027 slot, the exact structure the scores above
-- already exercise, so upsertScore()'s FR-ASM-020 check has a real active
-- assignment to pass against out of the box. Tenant B's row uses
-- admin@goldengate (proprietor, not seeded with a 'teacher' role_code) —
-- fine for this table's own isolation test, which is a raw-SQL RLS check,
-- not a re-run of teacher-assignments.service.ts's assertIsTeacher().
insert into teacher_assignments (id, tenant_id, teacher_id, class_id, subject_id, academic_year_id, created_by, updated_by) values
  ('92000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '99999999-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '99999999-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000002',
   '55555555-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- Role delegations (0026_delegation.sql, Chapter 13.4) — headmaster
-- delegating to teacher@sunrise (already active — starts_at in the
-- past); Golden Gate's uses the second seeded user above specifically
-- so this table has a real recipient distinct from its delegator.
insert into role_delegations (id, tenant_id, delegator_id, recipient_id, role_codes, reason, starts_at, ends_at, created_by) values
  ('93000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000003',
   array['headmaster'], 'Headmaster on leave', now() - interval '1 day', now() + interval '7 days',
   '99999999-0000-0000-0000-000000000001'),
  ('93000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000010',
   array['proprietor'], 'Proprietor travelling', now() - interval '1 day', now() + interval '7 days',
   '99999999-0000-0000-0000-000000000002');

-- Grading (0005_grading.sql) — one 'active', full [0,100]-coverage
-- numerical policy per tenant (so activatePolicy()'s gap/overlap checks
-- don't need to be exercised just to get a usable demo policy — they're
-- exercised live via curl instead, same reasoning as assessment's publish()
-- above) and one pre-computed result_candidates row per tenant, matching
-- what compute() would itself produce from the scores above:
--   Tenant A: class_exercise 32/100*40 = 12.80, end_of_term_exam 70/100*60
--     = 42.00, total 54.80% -> 'C' band.
--   Tenant B: class_exercise 35/100*40 = 14.00, end_of_term_exam 90/100*60
--     = 54.00, total 68.00% -> 'B' band.
-- The assessment_structures these reference are still 'draft' (never
-- seeded pre-published, per the assessment block's own comment above), so
-- this result_candidates row is a plausible target snapshot, not something
-- a fresh compute() call could reproduce until the structure is published
-- via curl first — fixed ids exist purely for the isolation suite's
-- direct-id-lookup tests.
insert into grading_policies (id, tenant_id, name, applicability, version, status, activated_at) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Standard Numerical Grading', 'numerical', 1, 'active', now()),
  ('a0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Standard Numerical Grading', 'numerical', 1, 'active', now());

insert into grading_scale_items (id, tenant_id, grading_policy_id, min_value, max_value, grade, point, remark, is_pass) values
  ('a1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-000000000001', 0,     49.99, 'F', 4, 'Fail',      false),
  ('a1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-000000000001', 50,    64.99, 'C', 3, 'Good',      true),
  ('a1111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-000000000001', 65,    79.99, 'B', 2, 'Very Good', true),
  ('a1111111-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-000000000001', 80,    100,   'A', 1, 'Excellent', true),
  ('a2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000002', 0,     49.99, 'F', 4, 'Fail',      false),
  ('a2222222-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000002', 50,    64.99, 'C', 3, 'Good',      true),
  ('a2222222-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000002', 65,    79.99, 'B', 2, 'Very Good', true),
  ('a2222222-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000002', 80,    100,   'A', 1, 'Excellent', true);

insert into result_candidates (id, tenant_id, assessment_structure_id, student_id, grading_policy_id, percentage, grade, point, remark, is_pass, created_by) values
  ('a3333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '66666666-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001', 54.80, 'C', 3, 'Good', true,
   '99999999-0000-0000-0000-000000000001'),
  ('a3333333-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '66666666-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000002', 68.00, 'B', 2, 'Very Good', true,
   '99999999-0000-0000-0000-000000000002');

-- Results management (0006_results.sql) — one 'draft' student_results row
-- per tenant (version 1, so results.service.ts's full workflow —
-- submit/review/approve/publish/lock/archive/reopen — can be walked
-- end-to-end live via curl from a clean starting state, same reasoning as
-- assessment's structures being left unpublished above) with one
-- snapshotted item matching the result_candidates row already seeded.
-- Fixed ids exist purely for the isolation suite's direct-id-lookup tests.
insert into student_results (id, tenant_id, student_id, class_id, academic_year_id, version, status, average_percentage, subjects_failed_count, overall_pass, created_by, updated_by) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 1, 'draft', 54.80, 0, true,
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000002', 1, 'draft', 68.00, 0, true,
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into student_result_items (id, tenant_id, student_result_id, subject_id, subject_name, grading_policy_id, percentage, grade, point, remark, is_pass, source_result_candidate_id) values
  ('b1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'b0000000-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'Mathematics',
   'a0000000-0000-0000-0000-000000000001', 54.80, 'C', 3, 'Good', true,
   'a3333333-0000-0000-0000-000000000001'),
  ('b1111111-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'b0000000-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000002', 'Mathematics',
   'a0000000-0000-0000-0000-000000000002', 68.00, 'B', 2, 'Very Good', true,
   'a3333333-0000-0000-0000-000000000002');

-- Promotion & documents (0007_promotion_documents.sql) — branding, one
-- promotion_decisions row per tenant off the student_results seeded above
-- (still 'draft' in fresh seed state, same "plausible target snapshot"
-- caveat the grading/results seed blocks above already carry — this is
-- exercised for real end-to-end via curl, not derived from a live
-- recommend() call here), and one report_card generated_document per
-- tenant. Tenant B's class is 'JHS 3' (see the classes insert above), so
-- its recommendation is 'complete', not 'promote' — exercising
-- promotion.service.ts's JHS-3 heuristic branch in the seed data itself.
-- Fixed ids exist purely for the isolation suite's direct-id-lookup tests.
insert into tenant_branding (id, tenant_id, signatory_name, signatory_title, created_by, updated_by) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Kwame Asante', 'Headmaster', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Abena Owusu', 'Proprietor', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into promotion_decisions (id, tenant_id, student_id, source_student_result_id, system_recommendation, created_by, updated_by) values
  ('c1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'promote',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('c1111111-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'complete',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into generated_documents (id, tenant_id, document_type, reference_number, verification_token, student_result_id, content, generated_by) values
  ('c2222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'report_card', 'RC-000001', 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
   'b0000000-0000-0000-0000-000000000001',
   '{"student":{"firstName":"Ama","lastName":"Mensah"},"averagePercentage":"54.80"}'::jsonb,
   '99999999-0000-0000-0000-000000000001'),
  ('c2222222-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'report_card', 'RC-000001', 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1',
   'b0000000-0000-0000-0000-000000000002',
   '{"student":{"firstName":"Ama","lastName":"Owusu"},"averagePercentage":"68.00"}'::jsonb,
   '99999999-0000-0000-0000-000000000002');

-- Finance Pass 1 (0008_finance.sql) — one 'active' fee structure per
-- tenant (Tuition 800 + Feeding 200 = 1000, matched by two 500 GHS
-- instalments, so activateFeeStructure()'s sum check is already
-- satisfied), one posted invoice against the seeded student at full
-- (unprorated) charge, and one partial cash payment (600 of 1000)
-- already allocated to it — leaving a real, nonzero balance (400) so the
-- allocation-cap and balance-lookup paths have something to show
-- immediately via curl, same "ready to exercise, not pre-exhausted"
-- reasoning as every other seed block above. Fixed ids exist purely for
-- the isolation suite's direct-id-lookup tests.
insert into fee_structures (id, tenant_id, academic_year_id, level, name, status, created_by, updated_by) values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'cccccccc-0000-0000-0000-000000000001', 'JHS 2', 'JHS 2 Fees 2026/2027', 'active',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'cccccccc-0000-0000-0000-000000000002', 'JHS 3', 'JHS 3 Fees 2026/2027', 'active',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into fee_structure_items (id, tenant_id, fee_structure_id, name, amount, created_by) values
  ('d1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000001', 'Tuition', 800, '99999999-0000-0000-0000-000000000001'),
  ('d1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000001', 'Feeding', 200, '99999999-0000-0000-0000-000000000001'),
  ('d2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'd0000000-0000-0000-0000-000000000002', 'Tuition', 800, '99999999-0000-0000-0000-000000000002'),
  ('d2222222-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'd0000000-0000-0000-0000-000000000002', 'Feeding', 200, '99999999-0000-0000-0000-000000000002');

insert into fee_instalments (id, tenant_id, fee_structure_id, sequence, amount, due_date, created_by) values
  ('d3333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000001', 1, 500, '2026-09-15', '99999999-0000-0000-0000-000000000001'),
  ('d3333333-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000001', 2, 500, '2027-01-15', '99999999-0000-0000-0000-000000000001'),
  ('d4444444-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'd0000000-0000-0000-0000-000000000002', 1, 500, '2026-09-15', '99999999-0000-0000-0000-000000000002'),
  ('d4444444-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'd0000000-0000-0000-0000-000000000002', 2, 500, '2027-01-15', '99999999-0000-0000-0000-000000000002');

insert into invoices (id, tenant_id, student_id, fee_structure_id, invoice_number, total_amount, due_date, issued_by, created_by, updated_by) values
  ('d5555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'INV-000001', 1000,
   '2027-01-15', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('d5555555-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'INV-000001', 1000,
   '2027-01-15', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into invoice_items (id, tenant_id, invoice_id, description, amount) values
  ('d6666666-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'd5555555-0000-0000-0000-000000000001', 'Tuition', 800),
  ('d6666666-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'd5555555-0000-0000-0000-000000000001', 'Feeding', 200),
  ('d6666666-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'd5555555-0000-0000-0000-000000000002', 'Tuition', 800),
  ('d6666666-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   'd5555555-0000-0000-0000-000000000002', 'Feeding', 200);

-- FR-FEE-040. Fixed ids exist purely for the isolation suite's direct-id-
-- lookup tests, same reasoning as every fixture above. The seeded invoices
-- (due 2027-01-15) aren't actually overdue yet as of this seed's fictional
-- "today", so applyPenalty()'s grace-period check can never fire against
-- them out of the box — deliberate, same "ready to exercise, not
-- pre-exhausted" posture as the rest of this file; a real overdue scenario
-- is created live (a fresh invoice with a past due_date) when exercising
-- this path, not baked into the seed.
insert into fee_penalty_rules
    (id, tenant_id, fee_structure_id, name, grace_period_days, amount_type, amount, cap_amount, frequency, created_by, updated_by) values
  ('d9999999-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000001', 'Late payment surcharge', 7, 'fixed', 50, 200, 'weekly',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('d9999999-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'd0000000-0000-0000-0000-000000000002', 'Late payment surcharge', 7, 'fixed', 50, 200, 'weekly',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into fee_penalty_charges (id, tenant_id, invoice_id, penalty_rule_id, amount, applied_by, reason) values
  ('da000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'd5555555-0000-0000-0000-000000000001', 'd9999999-0000-0000-0000-000000000001', 50,
   '99999999-0000-0000-0000-000000000001', 'seed fixture'),
  ('da000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'd5555555-0000-0000-0000-000000000002', 'd9999999-0000-0000-0000-000000000002', 50,
   '99999999-0000-0000-0000-000000000002', 'seed fixture');

insert into payments (id, tenant_id, student_id, method, provider_reference, amount, received_by, created_by, updated_by) values
  ('d7777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 'cash', 'CASH-0001', 600,
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('d7777777-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', 'cash', 'CASH-0001', 600,
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into payment_allocations (id, tenant_id, payment_id, invoice_id, amount, created_by) values
  ('d8888888-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'd7777777-0000-0000-0000-000000000001', 'd5555555-0000-0000-0000-000000000001', 600,
   '99999999-0000-0000-0000-000000000001'),
  ('d8888888-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'd7777777-0000-0000-0000-000000000002', 'd5555555-0000-0000-0000-000000000002', 600,
   '99999999-0000-0000-0000-000000000002');

-- Finance Pass 2 (0009_finance_assistance.sql) — one already-'approved'
-- scholarship per tenant against the invoice seeded above, below the
-- second-approval threshold (single-approver case; the live curl smoke
-- test is what exercises the two-different-approvers path, since that
-- needs two distinct actors making a judgment call, not seed data).
-- Combined with Pass 1's 600 GHS allocation, the seeded invoice's balance
-- is now 1000 - 600 - 100 = 300, not 400 — findInvoiceBalance() reflects
-- this automatically, nothing else needed. No reversals are seeded
-- (reversing something is exactly the live mechanic worth demonstrating
-- fresh, not something to pre-bake into a snapshot). Fixed ids exist
-- purely for the isolation suite's direct-id-lookup tests.
insert into financial_assistance (id, tenant_id, student_id, invoice_id, type, amount, reason, requires_second_approval, status, requested_by, approved_by, approved_at, created_by, updated_by) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 'd5555555-0000-0000-0000-000000000001',
   'scholarship', 100, 'Merit scholarship — top of class', false, 'approved',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', now(),
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', 'd5555555-0000-0000-0000-000000000002',
   'scholarship', 100, 'Merit scholarship — top of class', false, 'approved',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002', now(),
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- One small, never-allocated payment per tenant, immediately reversed —
-- purely a fixture for the isolation suite's reversals block (see above:
-- reversing anything real, like the invoice's actual 600 GHS payment, is
-- left for the live curl smoke test, not baked into the balance-affecting
-- seed state).
insert into payments (id, tenant_id, student_id, method, amount, received_by, created_by, updated_by) values
  ('e1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 'cash', 10,
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('e1111111-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', 'cash', 10,
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into reversals (id, tenant_id, reversed_entity_type, reversed_entity_id, amount, reason, created_by) values
  ('e2222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'payment', 'e1111111-0000-0000-0000-000000000001', 10, 'Recorded in error - duplicate entry',
   '99999999-0000-0000-0000-000000000001'),
  ('e2222222-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'payment', 'e1111111-0000-0000-0000-000000000002', 10, 'Recorded in error - duplicate entry',
   '99999999-0000-0000-0000-000000000002');

-- ============================================================================
-- Chapter 26 (Communication & Notification Centre) fixtures
-- ============================================================================

insert into notification_templates
  (id, tenant_id, code, channel, language, subject, body, variables, sensitivity_level, version, is_active, created_by, updated_by) values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'attendance_alert', 'whatsapp', 'en', null, 'Hello {{recipientName}}, {{studentName}} was marked {{status}} on {{date}}.',
   '["recipientName","studentName","status","date"]', 'normal', 1, true,
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'attendance_alert', 'whatsapp', 'en', null, 'Hello {{recipientName}}, {{studentName}} was marked {{status}} on {{date}}.',
   '["recipientName","studentName","status","date"]', 'normal', 1, true,
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- One explicit opt-out per tenant, on the same recipient the seeded
-- notification below targets — proves send()'s preference gate actually
-- skips a blocked channel (recorded as 'blocked_by_preference') rather
-- than silently ignoring it.
insert into communication_preferences (id, tenant_id, recipient_type, recipient_id, channel, opted_in, created_by, updated_by) values
  ('f1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'student', 'eeeeeeee-0000-0000-0000-000000000001', 'sms', false,
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('f1111111-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'student', 'eeeeeeee-0000-0000-0000-000000000002', 'sms', false,
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- An urgent, still-queued notification per tenant (not sent by the seed
-- itself — send()'s fallback sequencing is exercised live by the smoke
-- test, not baked into fixture state, same as finance's never-allocated
-- payment above).
insert into notifications
  (id, tenant_id, template_id, recipient_type, recipient_id, recipient_name, recipient_phone, recipient_email,
   subject, body, sensitivity_level, is_urgent, status, created_by, updated_by) values
  ('f2222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'f0000000-0000-0000-0000-000000000001', 'student', 'eeeeeeee-0000-0000-0000-000000000001',
   'Ama Mensah''s guardian', '+233200000001', 'guardian1@example.test',
   null, 'Hello Ama Mensah''s guardian, Ama Mensah was marked absent on 2026-08-05.', 'normal', true, 'queued',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('f2222222-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'f0000000-0000-0000-0000-000000000002', 'student', 'eeeeeeee-0000-0000-0000-000000000002',
   'Ama Owusu''s guardian', '+233200000002', 'guardian2@example.test',
   null, 'Hello Ama Owusu''s guardian, Ama Owusu was marked absent on 2026-08-05.', 'normal', true, 'queued',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- One already-attempted (and rejected, since no real provider exists yet —
-- see 0010_communication.sql's header) delivery row per tenant, so the
-- isolation suite has a real notification_deliveries row to test against
-- without needing to actually call send() first.
insert into notification_deliveries (id, tenant_id, notification_id, channel, attempt_sequence, status, error_message) values
  ('f3333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'f2222222-0000-0000-0000-000000000001', 'whatsapp', 1, 'rejected_not_implemented',
   'Channel ''whatsapp'' requires a real provider integration that is not implemented in this scaffold'),
  ('f3333333-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'f2222222-0000-0000-0000-000000000002', 'whatsapp', 1, 'rejected_not_implemented',
   'Channel ''whatsapp'' requires a real provider integration that is not implemented in this scaffold');

insert into tenant_communication_settings (id, tenant_id, monthly_sms_cost_threshold, alert_threshold_pct, created_by, updated_by) values
  ('f4444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 200, 80,
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('f4444444-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 200, 80,
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- One open, past-deadline report per tenant, assigned to the seeded
-- teacher/headmaster — a fixture for the isolation suite AND for
-- findOverdueReports()/escalateReport() to have something real to act on
-- without waiting for a real deadline to pass.
insert into notification_reports
  (id, tenant_id, notification_id, title, description, owner_user_id, assigned_by, deadline, status, created_by, updated_by) values
  ('f5555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'f2222222-0000-0000-0000-000000000001', 'Follow up on Ama Mensah''s absence',
   'Guardian has not responded to the attendance alert.', '99999999-0000-0000-0000-000000000003',
   '99999999-0000-0000-0000-000000000001', '2026-08-01T00:00:00Z', 'open',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('f5555555-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'f2222222-0000-0000-0000-000000000002', 'Follow up on Ama Owusu''s absence',
   'Guardian has not responded to the attendance alert.', '99999999-0000-0000-0000-000000000002',
   '99999999-0000-0000-0000-000000000002', '2026-08-01T00:00:00Z', 'open',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into notification_report_comments (id, tenant_id, report_id, author_user_id, comment) values
  ('f6666666-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'f5555555-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000003',
   'Called the guardian, no answer yet — will try again tomorrow.'),
  ('f6666666-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'f5555555-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002',
   'Called the guardian, no answer yet — will try again tomorrow.');

-- ============================================================================
-- Chapter 28 (Discipline) fixtures — one case worked through investigation,
-- response, guardian contact and a pending appeal per tenant, plus one
-- positive-behaviour recognition per tenant. reopenCase()/decideAppeal()
-- are exercised live by the smoke test, not baked into fixture state, same
-- as communication's send() above.
-- ============================================================================

insert into discipline_cases
  (id, tenant_id, student_id, category, severity, incident_date, description, reported_by, status, created_by, updated_by) values
  ('f7777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 'fighting', 'major', '2026-08-01',
   'Altercation with another student during break time.', '99999999-0000-0000-0000-000000000001', 'appealed',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('f7777777-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', 'fighting', 'major', '2026-08-01',
   'Altercation with another student during break time.', '99999999-0000-0000-0000-000000000002', 'appealed',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into discipline_case_notes (id, tenant_id, case_id, author_user_id, note) values
  ('f8888888-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'f7777777-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000003',
   'Spoke with both students separately; conflicting accounts.'),
  ('f8888888-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'f7777777-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002',
   'Spoke with both students separately; conflicting accounts.');

insert into discipline_case_responses (id, tenant_id, case_id, response_type, description, created_by) values
  ('f9999999-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'f7777777-0000-0000-0000-000000000001', 'detention', 'Two days after-school detention.',
   '99999999-0000-0000-0000-000000000001'),
  ('f9999999-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'f7777777-0000-0000-0000-000000000002', 'detention', 'Two days after-school detention.',
   '99999999-0000-0000-0000-000000000002');

-- channel = 'phone_call' (logged only, no dispatch) so this fixture needs
-- no real notifications row — contactGuardian()'s whatsapp/sms/email
-- dispatch path is exercised live by the smoke test instead.
insert into discipline_guardian_contacts (id, tenant_id, case_id, recipient_type, recipient_id, channel, notes, created_by) values
  ('faaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'f7777777-0000-0000-0000-000000000001', 'student', 'eeeeeeee-0000-0000-0000-000000000001', 'phone_call',
   'Called guardian to inform about the detention; guardian acknowledged.', '99999999-0000-0000-0000-000000000003'),
  ('faaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'f7777777-0000-0000-0000-000000000002', 'student', 'eeeeeeee-0000-0000-0000-000000000002', 'phone_call',
   'Called guardian to inform about the detention; guardian acknowledged.', '99999999-0000-0000-0000-000000000002');

insert into discipline_appeals (id, tenant_id, case_id, raised_by, reason, decision, created_by, updated_by) values
  ('fbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'f7777777-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001',
   'Guardian disputes the account of who started the altercation.', 'pending',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('fbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'f7777777-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002',
   'Guardian disputes the account of who started the altercation.', 'pending',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into discipline_recognitions (id, tenant_id, student_id, category, description, awarded_by, created_by, updated_by) values
  ('fccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 'academic_excellence', 'Top of class in Mathematics this term.',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('fccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', 'academic_excellence', 'Top of class in Mathematics this term.',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- ============================================================================
-- Chapter 28 (Library) fixtures — one catalogue item with one copy already
-- on loan per tenant, so available_copies genuinely reflects the seeded
-- loan rather than just matching total_copies by coincidence.
-- ============================================================================

insert into library_items (id, tenant_id, title, author, category, total_copies, available_copies, created_by, updated_by) values
  ('70000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Basic English Grammar', 'K. Osei', 'textbook', 3, 2,
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Basic English Grammar', 'K. Osei', 'textbook', 3, 2,
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into library_members (id, tenant_id, student_id, created_by) values
  ('71111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('71111111-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into library_loans (id, tenant_id, item_id, member_id, due_date, created_by, updated_by) values
  ('72222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '70000000-0000-0000-0000-000000000001', '71111111-0000-0000-0000-000000000001', current_date + 14,
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('72222222-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '70000000-0000-0000-0000-000000000002', '71111111-0000-0000-0000-000000000002', current_date + 14,
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- ============================================================================
-- Chapter 28 (Transport) fixtures — one route with a stop, a vehicle, a
-- driver and one active student assignment per tenant. assignStudentToRoute()'s
-- supersede-on-reassign path is exercised live by the smoke test, not
-- baked into fixture state.
-- ============================================================================

insert into transport_routes (id, tenant_id, name, description, created_by, updated_by) values
  ('73333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Achimota - Sunrise Basic', 'Morning and afternoon run via Achimota.',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('73333333-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Achimota - Sunrise Basic', 'Morning and afternoon run via Achimota.',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into transport_stops (id, tenant_id, route_id, name, sequence_no, created_by) values
  ('74444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '73333333-0000-0000-0000-000000000001', 'Achimota Overhead', 1, '99999999-0000-0000-0000-000000000001'),
  ('74444444-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '73333333-0000-0000-0000-000000000002', 'Achimota Overhead', 1, '99999999-0000-0000-0000-000000000002');

insert into transport_vehicles (id, tenant_id, registration_no, capacity, route_id, created_by, updated_by) values
  ('75555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'GT-1234-20', 30, '73333333-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('75555555-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'GT-5678-20', 30, '73333333-0000-0000-0000-000000000002',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into transport_drivers (id, tenant_id, name, license_no, phone, vehicle_id, created_by, updated_by) values
  ('76666666-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Kojo Mensah', 'DVLA-000111', '+233200000101', '75555555-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('76666666-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Kojo Mensah', 'DVLA-000222', '+233200000102', '75555555-0000-0000-0000-000000000002',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into transport_student_assignments (id, tenant_id, student_id, route_id, stop_id, created_by, updated_by) values
  ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', '73333333-0000-0000-0000-000000000001', '74444444-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('77777777-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', '73333333-0000-0000-0000-000000000002', '74444444-0000-0000-0000-000000000002',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- ============================================================================
-- Chapter 28 (Health) fixtures — one restricted health record, one open
-- incident with a logged (not dispatched) guardian contact, and one
-- medication log entry per tenant. contactGuardian()'s dispatch path and
-- resolveIncident()/reopenIncident() are exercised live by the smoke
-- test, not baked into fixture state.
-- ============================================================================

insert into health_records (id, tenant_id, student_id, blood_group, allergies, notes, created_by, updated_by) values
  ('78888888-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 'O+', 'Peanuts', 'Carries own inhaler for mild asthma.',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('78888888-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', 'O+', 'Peanuts', 'Carries own inhaler for mild asthma.',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into health_incidents (id, tenant_id, student_id, incident_date, description, severity, created_by, updated_by) values
  ('79999999-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', '2026-08-06', 'Mild asthma attack during PE class; used own inhaler.',
   'moderate', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('79999999-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', '2026-08-06', 'Mild asthma attack during PE class; used own inhaler.',
   'moderate', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into health_incident_guardian_contacts (id, tenant_id, incident_id, recipient_type, recipient_id, channel, notes, created_by) values
  ('7aaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '79999999-0000-0000-0000-000000000001', 'student', 'eeeeeeee-0000-0000-0000-000000000001', 'phone_call',
   'Called guardian to inform about the asthma episode; guardian will collect a spare inhaler.', '99999999-0000-0000-0000-000000000003'),
  ('7aaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '79999999-0000-0000-0000-000000000002', 'student', 'eeeeeeee-0000-0000-0000-000000000002', 'phone_call',
   'Called guardian to inform about the asthma episode; guardian will collect a spare inhaler.', '99999999-0000-0000-0000-000000000002');

insert into medication_administration_log (id, tenant_id, student_id, medication_name, dosage, administered_by, notes) values
  ('7bbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 'Salbutamol inhaler', '2 puffs', '99999999-0000-0000-0000-000000000003',
   'Administered after the PE class incident.'),
  ('7bbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', 'Salbutamol inhaler', '2 puffs', '99999999-0000-0000-0000-000000000002',
   'Administered after the PE class incident.');

-- ============================================================================
-- Chapter 28 (Inventory) fixtures — one catalogue item, one issuance
-- against it, and one already-logged low-stock alert per tenant.
-- issueStock()'s live low-stock-crossing path (with a real dispatched
-- notification) is exercised by the smoke test, not baked into fixture
-- state.
-- ============================================================================

insert into inventory_items (id, tenant_id, name, category, unit, quantity_on_hand, reorder_threshold, created_by, updated_by) values
  ('7ccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Exercise Book (A4)', 'stationery', 'each', 50, 20,
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('7ccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Exercise Book (A4)', 'stationery', 'each', 50, 20,
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into inventory_issuances (id, tenant_id, item_id, issued_to_type, issued_to_id, quantity, issued_by, purpose) values
  ('7ddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '7ccccccc-0000-0000-0000-000000000001', 'student', 'eeeeeeee-0000-0000-0000-000000000001', 5,
   '99999999-0000-0000-0000-000000000001', 'Term 2 stationery issue'),
  ('7ddddddd-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '7ccccccc-0000-0000-0000-000000000002', 'student', 'eeeeeeee-0000-0000-0000-000000000002', 5,
   '99999999-0000-0000-0000-000000000002', 'Term 2 stationery issue');

insert into inventory_alerts (id, tenant_id, item_id, quantity_on_hand, reorder_threshold) values
  ('7eeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '7ccccccc-0000-0000-0000-000000000001', 15, 20),
  ('7eeeeeee-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '7ccccccc-0000-0000-0000-000000000002', 15, 20);

-- ============================================================================
-- Chapter 13/33 (Authorization Pass 1) fixtures — one audit_log row per
-- tenant, inserted directly (as the owner role, same as every other seed
-- insert here) since real rows are normally only ever written by
-- AuditLogInterceptor/RolesGuard at request time, never by a migration or
-- a client — a fixed fixture row is what the isolation suite needs to
-- assert against, same reasoning as every other table's seed data.
-- ============================================================================

insert into audit_log (id, tenant_id, actor_user_id, actor_role_codes, action, method, path, status_code) values
  ('7fffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '99999999-0000-0000-0000-000000000001', array['headmaster'], 'create', 'POST', '/v1/finance/payments', 201),
  ('7fffffff-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '99999999-0000-0000-0000-000000000002', array['proprietor'], 'create', 'POST', '/v1/finance/payments', 201);

-- ============================================================================
-- Chapter 35 (Phase D, 0027_background_jobs.sql) fixtures — one queued
-- background_jobs row and one active job_schedules row per tenant, fixed
-- ids for the isolation suite's direct-id-lookup tests. next_run_at is
-- deliberately in the future so a casual `npm run worker:dev` during
-- manual testing doesn't immediately consume this fixture.
-- ============================================================================

insert into background_jobs (id, tenant_id, job_type, payload, status, created_by, updated_by) values
  ('94000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'report_card_batch',
   jsonb_build_object('classId', 'dddddddd-0000-0000-0000-000000000001', 'academicYearId', 'cccccccc-0000-0000-0000-000000000001'),
   'queued', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('94000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'report_card_batch',
   jsonb_build_object('classId', 'dddddddd-0000-0000-0000-000000000002', 'academicYearId', 'cccccccc-0000-0000-0000-000000000002'),
   'queued', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into job_schedules (id, tenant_id, job_type, payload_template, frequency, next_run_at, created_by, updated_by) values
  ('95000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'report_card_batch',
   jsonb_build_object('classId', 'dddddddd-0000-0000-0000-000000000001', 'academicYearId', 'cccccccc-0000-0000-0000-000000000001'),
   'termly', now() + interval '30 days', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('95000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'report_card_batch',
   jsonb_build_object('classId', 'dddddddd-0000-0000-0000-000000000002', 'academicYearId', 'cccccccc-0000-0000-0000-000000000002'),
   'termly', now() + interval '30 days', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- ============================================================================
-- Chapter 14 (Phase E, 0028_analytics.sql) fixtures — one active
-- tenant-wide KPI definition and one snapshot per tenant, fixed ids for
-- the isolation suite's direct-id-lookup tests.
-- ============================================================================

insert into kpi_definitions
  (id, tenant_id, code, name, responsible_role, data_source, reporting_frequency, supervisor_user_id, created_by, updated_by) values
  ('96000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'collection-rate', 'Fee Collection Rate', 'accountant', 'collection_rate', 'termly',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('96000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'collection-rate', 'Fee Collection Rate', 'accountant', 'collection_rate', 'termly',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into kpi_snapshots (id, tenant_id, kpi_definition_id, period_start, period_end, value, status, created_by) values
  ('96100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '96000000-0000-0000-0000-000000000001', '2026-01-01', '2026-03-31', 75.00, 'warning', '99999999-0000-0000-0000-000000000001'),
  ('96100000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '96000000-0000-0000-0000-000000000002', '2026-01-01', '2026-03-31', 90.00, 'on_target', '99999999-0000-0000-0000-000000000002');

-- ============================================================================
-- Chapter 39-40 (Phase F, 0029_data_protection.sql) fixtures — one
-- received data-subject request and one granted consent record per
-- tenant, fixed ids for the isolation suite's direct-id-lookup tests.
-- data_inventory/retention_policies/data_breach_incidents are platform
-- reference tables (no RLS, same category as `plans`) — seeded directly
-- inside 0029_data_protection.sql itself, not here.
-- ============================================================================

insert into data_subject_requests
  (id, tenant_id, request_type, subject_type, subject_id, requester_name, due_date, created_by, updated_by) values
  ('97000000-1000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'access', 'guardian', '90000000-0000-0000-0000-000000000001', 'Ama Mensah''s guardian',
   now() + interval '30 days', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('97000000-1000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'access', 'student', 'eeeeeeee-0000-0000-0000-000000000002', 'Ama Owusu''s guardian',
   now() + interval '30 days', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into consent_records
  (id, tenant_id, subject_type, subject_id, consent_type, channel, granted, version, recorded_by) values
  ('97000000-2000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'guardian', '90000000-0000-0000-0000-000000000001', 'communication_channel', 'sms', true, 1,
   '99999999-0000-0000-0000-000000000001'),
  ('97000000-2000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'guardian', '90000000-0000-0000-0000-000000000002', 'communication_channel', 'sms', true, 1,
   '99999999-0000-0000-0000-000000000002');

-- ============================================================================
-- Chapter 41 (Phase G, 0030_nacca_curriculum.sql) fixtures — one row per
-- new table per tenant, fixed ids for the isolation suite's
-- direct-id-lookup tests.
-- ============================================================================

insert into school_academic_settings (id, tenant_id, school_id, uses_nacca_curriculum, created_by, updated_by) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', true,
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-0000-0000-0000-000000000001', false,
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into curriculum_strands (id, tenant_id, subject_id, name, code, created_by, updated_by) values
  ('a2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '55555555-0000-0000-0000-000000000001', 'Number', 'NUM',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '55555555-0000-0000-0000-000000000002', 'Number', 'NUM',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into curriculum_sub_strands (id, tenant_id, strand_id, name, code, created_by, updated_by) values
  ('a3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a2000000-0000-0000-0000-000000000001', 'Number and Numeration', 'NUM-1',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a2000000-0000-0000-0000-000000000002', 'Number and Numeration', 'NUM-1',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into curriculum_indicators
  (id, tenant_id, sub_strand_id, content_standard_code, content_standard_text, indicator_code, indicator_text, created_by, updated_by) values
  ('a4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a3000000-0000-0000-0000-000000000001', 'B7.1.1.1', 'Demonstrate understanding of place value',
   'B7.1.1.1.1', 'Round numbers to the nearest 10, 100 or 1000',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('a4000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a3000000-0000-0000-0000-000000000002', 'B7.1.1.1', 'Demonstrate understanding of place value',
   'B7.1.1.1.1', 'Round numbers to the nearest 10, 100 or 1000',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into bece_candidates (id, tenant_id, student_id, academic_year_id, index_number, created_by, updated_by) values
  ('a5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'SUN-20262027-0001',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('a5000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', 'GGPJHS-20262027-0001',
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into bece_mock_results (id, tenant_id, bece_candidate_id, exam_session, subject_name, grade, score_percentage, created_by) values
  ('a6000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a5000000-0000-0000-0000-000000000001', 'Mock 1 2026', 'Mathematics', 3, 68.00,
   '99999999-0000-0000-0000-000000000001'),
  ('a6000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a5000000-0000-0000-0000-000000000002', 'Mock 1 2026', 'Mathematics', 2, 74.00,
   '99999999-0000-0000-0000-000000000002');

insert into cssps_placements (id, tenant_id, student_id, choices, created_by, updated_by) values
  ('a7000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', array['Achimota School', 'Presec Legon'],
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('a7000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'eeeeeeee-0000-0000-0000-000000000002', array['Wesley Girls'],
   '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- Timetable (0033_timetable.sql, Chapter 17 spec §7.6 / FR-ACA-040) — one
-- room, one teaching period, and one active entry per tenant, reusing the
-- same class/subject/teacher (JHS 2A / Mathematics / teacher@sunrise) the
-- assessment/teacher-assignment fixtures above already exercise. Fixed ids
-- exist purely for the isolation suite's direct-id-lookup tests, same
-- reasoning as every fixture above.
insert into rooms (id, tenant_id, name, capacity, created_by, updated_by) values
  ('a8000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Block A - Room 1', 40, '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('a8000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Block A - Room 1', 40, '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into periods (id, tenant_id, name, sequence, start_time, end_time, period_type, created_by, updated_by) values
  ('a8100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Period 1', 1, '08:00', '08:40', 'teaching', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('a8100000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Period 1', 1, '08:00', '08:40', 'teaching', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into timetable_entries
    (id, tenant_id, academic_year_id, class_id, subject_id, teacher_id, period_id, room_id, day_of_week, created_by, updated_by) values
  ('a8200000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000003', 'a8100000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000001',
   'monday', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('a8200000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'cccccccc-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000002',
   '99999999-0000-0000-0000-000000000002', 'a8100000-0000-0000-0000-000000000002', 'a8000000-0000-0000-0000-000000000002',
   'monday', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- Settlement reconciliation (0034_settlement_reconciliation.sql, spec
-- §8.8) — one open batch per tenant with one line already auto-matchable
-- against the seeded payment above (d7777777-...-01, reference 'CASH-0001',
-- amount 600), so autoMatchSettlementBatch() has something real to match
-- immediately via curl, same "ready to exercise, not pre-exhausted"
-- posture as the rest of this file. Left UNMATCHED here (not
-- pre-matched) so the match/auto-match path itself is exercised live,
-- not just displayed.
insert into settlement_batches (id, tenant_id, source, reference, notes, created_by, updated_by) values
  ('a9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'bank_statement', 'STMT-2026-08', 'August 2026 bank statement', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('a9000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'bank_statement', 'STMT-2026-08', 'August 2026 bank statement', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

insert into settlement_lines (id, tenant_id, settlement_batch_id, line_reference, amount, value_date, description, created_by, updated_by) values
  ('a9100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a9000000-0000-0000-0000-000000000001', 'CASH-0001', 600, current_date, 'Cash lodgement', '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001'),
  ('a9100000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a9000000-0000-0000-0000-000000000002', 'CASH-0001', 600, current_date, 'Cash lodgement', '99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002');

-- ============================================================================
-- PROOF OF ISOLATION — run these manually after seeding
-- ============================================================================
-- As Tenant A, you should see exactly one student (Ama Mensah):
--   SET app.current_tenant = '11111111-1111-1111-1111-111111111111';
--   SELECT first_name, last_name FROM students;
--
-- As Tenant B, you should see exactly one student (Ama Owusu) — NOT Ama
-- Mensah, even though both rows physically exist in the same students table:
--   SET app.current_tenant = '22222222-2222-2222-2222-222222222222';
--   SELECT first_name, last_name FROM students;
--
-- With no tenant set at all, you should see ZERO rows, not all of them:
--   RESET app.current_tenant;
--   SELECT first_name, last_name FROM students;
--
-- This last case is the one that matters most: a bug that forgets to set
-- the tenant context should fail safe (see nothing) rather than fail open
-- (see everything). That is exactly what current_tenant_id() returning NULL
-- against a `tenant_id = NULL` comparison gives you, because NULL = NULL is
-- not true in SQL — confirm this yourself, it is the whole point of TEN-001.
-- ============================================================================
