/**
 * role-groups.ts
 *
 * Mirrors apps/api/src/common/auth/role-groups.ts by hand. No shared
 * `packages/` workspace exists (Stage 1's own "avoid new infrastructure
 * where avoidable" call, made again here) — this is a small, rarely-changing
 * list, so a hand-kept mirror is cheaper than a new workspace. If the two
 * files diverge, `grep -r role-groups.ts` from the repo root finds both.
 */

export const LEADERSHIP = ['proprietor', 'administrator', 'headmaster'] as const;

export const ACADEMIC_ADMIN = [
  ...LEADERSHIP,
  'assistant_headmaster',
  'academic_coordinator',
  'examination_officer',
  'admission_officer',
] as const;

export const TEACHING_STAFF = ['teacher'] as const;

export const ACADEMIC_STAFF = [...ACADEMIC_ADMIN, ...TEACHING_STAFF] as const;

export const ADMISSIONS_TEAM = [...LEADERSHIP, 'admission_officer'] as const;

export const LIBRARY_TEAM = [...LEADERSHIP, 'librarian'] as const;

export const TRANSPORT_TEAM = [...LEADERSHIP, 'transport_officer'] as const;

export const HEALTH_TEAM = [...LEADERSHIP, 'health_officer'] as const;

export const INVENTORY_TEAM = [...LEADERSHIP, 'storekeeper'] as const;

export const ALL_STAFF = [
  ...ACADEMIC_STAFF,
  'accountant',
  'librarian',
  'health_officer',
  'storekeeper',
  'transport_officer',
] as const;

export function hasAnyRole(userRoleCodes: string[], required: readonly string[]): boolean {
  return userRoleCodes.some((code) => required.includes(code));
}
