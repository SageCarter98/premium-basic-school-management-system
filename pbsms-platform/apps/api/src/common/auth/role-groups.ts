/**
 * role-groups.ts — named role-code tiers shared across controllers, built
 * from SRS Chapter 3.2's school-level role list. Each module's controller
 * composes these (or, for Finance-shaped segregation-of-duties, defines
 * its own narrower tiers inline — see finance.controller.ts) rather than
 * hand-rolling role arrays per file.
 *
 * These are ROLE tiers only (Chapter 13.2). They are NOT record-relationship
 * scope (Chapter 13.3 — assigned students / linked children / record
 * ownership) — that depends on guardians/teacher-assignment existing as
 * real entities, which they don't yet (see README's deferred-items list).
 * A 'teacher' granted TEACHING_STAFF access can act on ANY class's records
 * via these endpoints today, not just their own assigned class.
 */

export const LEADERSHIP = ['proprietor', 'administrator', 'headmaster'];

// Chapter 3.2: "School Administrator, Headmaster, Assistant Headmaster /
// Academic Coordinator, Examination Officer / Admission Officer" — the
// tier that configures academic structure, runs admissions, and performs
// the senior/administrative steps of academic workflows (review, approve,
// publish, revoke, decide).
export const ACADEMIC_ADMIN = [...LEADERSHIP, 'assistant_headmaster', 'academic_coordinator', 'examination_officer', 'admission_officer'];

export const TEACHING_STAFF = ['teacher'];

// Anyone with an academic role — the "maker" tier for academic workflows
// (submit, correct, score entry, case reporting) and broad read access to
// academic data (assessment/grading/results/promotion/documents/
// attendance/discipline/communication).
export const ACADEMIC_STAFF = [...ACADEMIC_ADMIN, ...TEACHING_STAFF];

export const ADMISSIONS_TEAM = [...LEADERSHIP, 'admission_officer'];
export const LIBRARY_TEAM = [...LEADERSHIP, 'librarian'];
export const TRANSPORT_TEAM = [...LEADERSHIP, 'transport_officer'];
export const HEALTH_TEAM = [...LEADERSHIP, 'health_officer'];
export const INVENTORY_TEAM = [...LEADERSHIP, 'storekeeper'];

// Genuinely cross-cutting reference data (student/school/class/enrolment
// lookups) that non-academic support staff also plausibly need — a
// librarian issuing a book or a transport officer assigning a route both
// need to look up a student record.
export const ALL_STAFF = [...ACADEMIC_STAFF, 'accountant', 'librarian', 'health_officer', 'storekeeper', 'transport_officer'];
