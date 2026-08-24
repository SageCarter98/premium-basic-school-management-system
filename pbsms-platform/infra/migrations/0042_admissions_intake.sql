-- ============================================================================
-- 0042_admissions_intake.sql
--
-- Closes a real gap between FR-ADM-010's actual spec text and what
-- 0002_admissions.sql's `applicants` table captured: "Capture applicant
-- identity, photo, birth/nationality/language/address, previous school,
-- guardian and emergency contacts, medical and learning-support
-- information, supporting documents, and interview/entrance-assessment
-- outcomes." 0002 only ever captured identity/dob/gender/previous_school —
-- everything else FR-ADM-010 names was simply never added. Found during
-- the 2026-08-24 bug-list closure round, when a real Admissions frontend
-- was built for the first time and turned out to have nowhere to put most
-- of what an actual intake form needs.
--
-- All new columns are additive and nullable — no backfill needed, no
-- existing row becomes invalid.
--
-- Guardian/emergency contact info is captured as plain snapshot columns
-- on the applicant, NOT a link into the real `guardians` table (0019) —
-- an applicant isn't a student yet, and `student_guardians` is keyed to a
-- real student_id. Promoting this snapshot into a real guardian record at
-- conversion time is a genuinely separate feature (which relationship
-- flags to default, whether to detect an existing guardian by phone/email
-- vs always create a new one) — flagged, not built here, same as this
-- codebase's existing precedent of not silently expanding a migration's
-- own scope (see 0007's header on generated_documents' content-JSON-only
-- choice for the same kind of restraint).
--
-- `photo_url` and `documents_checklist` are NOT a real upload/storage
-- mechanism — this scaffold has no object storage anywhere (README's
-- "What's actually here vs. what isn't" table already flags this for
-- FR-DOC-020/030's report cards). `photo_url` is an external URL
-- reference only; `documents_checklist` is a JSONB array of
-- {name, received} so staff can track which physical/emailed documents
-- have arrived without this codebase pretending to store the files
-- themselves.
-- ============================================================================

alter table applicants
  add column photo_url               text,
  add column nationality             text,
  add column home_language           text,
  add column address                 text,
  add column guardian_name           text,
  add column guardian_phone          text,
  add column guardian_email          text,
  add column guardian_relationship   text,
  add column emergency_contact_name  text,
  add column emergency_contact_phone text,
  add column medical_notes           text,
  add column learning_support_notes  text,
  -- [{"name": "Birth certificate", "received": true}, ...] — see header.
  add column documents_checklist     jsonb not null default '[]'::jsonb,
  add column interview_date          timestamptz,
  add column interview_notes         text,
  add column assessment_notes        text;
