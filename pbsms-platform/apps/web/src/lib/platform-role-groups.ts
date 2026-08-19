/**
 * platform-role-groups.ts
 *
 * Mirrors apps/api/src/common/auth/platform-role-groups.ts by hand, same
 * reasoning as role-groups.ts's own header (no shared `packages/`
 * workspace exists). This is the platform-actor equivalent — Platform
 * Console's `hasAnyRole()` checks read a token's `roleCodes` the same way
 * either way, but a platform token's roleCodes come from
 * `platform_user_roles`, never a tenant's `role_codes`.
 */

export const PLATFORM_SUPER_ADMIN = ['platform_super_admin'] as const;

export const PLATFORM_ONBOARDING = [...PLATFORM_SUPER_ADMIN, 'onboarding_specialist'] as const;

export const PLATFORM_BILLING = [...PLATFORM_SUPER_ADMIN, 'billing_administrator'] as const;

export const PLATFORM_ALL = [
  ...PLATFORM_SUPER_ADMIN,
  'support_engineer',
  'billing_administrator',
  'onboarding_specialist',
] as const;

export function hasAnyPlatformRole(userRoleCodes: string[], required: readonly string[]): boolean {
  return userRoleCodes.some((code) => required.includes(code));
}
