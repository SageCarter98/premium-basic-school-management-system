/**
 * role-coverage.ts — §47.15.1's "coverage across every role in the
 * Frontend Design Specification §10, because scope enforcement fails per
 * role, not globally." Two genuinely different kinds of "coverage" exist
 * for this one capability, and this file keeps them explicit rather than
 * blurring them:
 *
 *  1. ROUTE-LEVEL coverage: does this role's tier even reach
 *     AssistantRetrievalController's handler at all? That's decided by
 *     the `@Roles(...ACADEMIC_STAFF)` decorator (role-groups.ts),
 *     enforced by RolesGuard — a layer this eval harness cannot exercise
 *     directly, because (like every other e2e suite in this repo) it
 *     constructs AssistantRetrievalService directly against a
 *     WorkerTenantConnection rather than booting Nest's HTTP stack (no
 *     *.e2e-spec.ts file in this repo does — see fixtures.ts's header).
 *     What CAN be checked without an HTTP boot is the actual decorator
 *     metadata Nest reads at request time (`Reflect.getMetadata`) against
 *     `ACADEMIC_STAFF` — a real, source-of-truth check, just not a live
 *     HTTP 403. See the eval spec's "route-level role coverage" block.
 *
 *  2. SCOPE-LEVEL coverage: for a role that DOES reach the handler, does
 *     TeacherAssignmentsService.getCallerScope() restrict it correctly?
 *     Every ACADEMIC_STAFF tier maps to `unrestricted: true` except a
 *     caller whose roles are exactly `['teacher']` — see
 *     teacher-assignments.service.ts's getCallerScope(). The golden set
 *     (golden-cases.ts) exercises every one of these role codes against
 *     the real service, not just 'headmaster' and 'teacher', specifically
 *     because a role-code typo or an accidental second exact-match branch
 *     would be invisible testing only one role of each kind.
 *
 * FDS §10 lists nine role rows. This maps each to the role_code(s) this
 * codebase actually uses (role-groups.ts, seed_demo.sql, the
 * 0001_init_tenancy.sql role_code comment) — a mapping worth keeping
 * explicit and reviewable, not implicit in test code, because it's the
 * thing most likely to silently drift as new roles are added.
 */

import { ACADEMIC_STAFF } from '../../src/common/auth/role-groups';

export interface FdsRoleMapping {
  fdsRole: string; // FDS §10's own row label
  roleCode: string;
  hasRouteAccess: boolean; // is roleCode in ACADEMIC_STAFF (the @Roles() list on the handler)?
  note?: string;
}

export const FDS_ROLE_COVERAGE: FdsRoleMapping[] = [
  { fdsRole: 'Proprietor / Director', roleCode: 'proprietor', hasRouteAccess: true },
  { fdsRole: 'Headmaster', roleCode: 'headmaster', hasRouteAccess: true },
  { fdsRole: 'Accountant / Bursar', roleCode: 'accountant', hasRouteAccess: false },
  { fdsRole: 'Academic Coordinator', roleCode: 'academic_coordinator', hasRouteAccess: true },
  { fdsRole: 'Class / Subject Teacher', roleCode: 'teacher', hasRouteAccess: true },
  {
    fdsRole: 'Admissions Officer',
    roleCode: 'admission_officer',
    hasRouteAccess: true,
    note:
      "FDS §10's own row says an Admissions Officer 'does not see academic records beyond conversion', but " +
      "role-groups.ts's ACADEMIC_ADMIN (and so ACADEMIC_STAFF) includes 'admission_officer' — a real tension " +
      'between the FDS narrative and the role-groups.ts grouping this Stage-2 harness found, not created. ' +
      "Recorded here rather than silently worked around: whether admission_officer's ACADEMIC_STAFF membership " +
      "is correct is a Stage-1/role-groups.ts question, out of this PR's scope (that file is not touched here).",
  },
  { fdsRole: 'Parent / Guardian', roleCode: 'parent', hasRouteAccess: false },
  { fdsRole: 'Student', roleCode: 'student', hasRouteAccess: false },
  {
    fdsRole: 'Platform Support',
    roleCode: 'platform_support',
    hasRouteAccess: false,
    note:
      'Not a tenant role_code at all (platform staff use platform_user_roles, Ch 3.1) and, more to the point, ' +
      'TEN-055 disables the Assistant outright for any impersonation-grant session regardless of role — already ' +
      'covered by tenant-ai-assistant-isolation.e2e-spec.ts and reinforced here by an adversarial case that ' +
      "combines impersonation with an otherwise-fully-unrestricted role, per this file's own adversarial corpus.",
  },
];

// role-groups.ts's ACADEMIC_ADMIN also contains 'assistant_headmaster' and
// 'examination_officer', and LEADERSHIP contains 'administrator' — three
// route-accessible tiers FDS §10 doesn't give their own row (folded under
// "Headmaster" or left unnamed). Structurally identical to
// 'academic_coordinator'/'headmaster' (unrestricted, no Chapter 13.3
// narrowing) — included in the golden set for the same reason every
// ACADEMIC_STAFF code is: a role-code-specific regression should be
// visible per role, not just for the two FDS names it.
export const EXTRA_ACADEMIC_STAFF_ROLE_CODES = ['assistant_headmaster', 'examination_officer', 'administrator'] as const;

export const ALL_ROUTE_ACCESSIBLE_ROLE_CODES: readonly string[] = [
  ...FDS_ROLE_COVERAGE.filter((r) => r.hasRouteAccess).map((r) => r.roleCode),
  ...EXTRA_ACADEMIC_STAFF_ROLE_CODES,
];

export const UNRESTRICTED_ROLE_CODES: readonly string[] = ALL_ROUTE_ACCESSIBLE_ROLE_CODES.filter((r) => r !== 'teacher');

// Sanity: this file's own claim about ACADEMIC_STAFF's membership should
// match role-groups.ts exactly, both directions — checked in the eval
// spec itself (not here) so a mismatch fails a real test, not silently.
export { ACADEMIC_STAFF };
