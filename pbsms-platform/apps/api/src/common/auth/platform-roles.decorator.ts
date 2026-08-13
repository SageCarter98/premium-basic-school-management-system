/**
 * platform-roles.decorator.ts — the Chapter 3.1 platform-role equivalent
 * of roles.decorator.ts. A SEPARATE decorator/guard pair from @Roles()/
 * RolesGuard, not a reuse of them, because platform routes never resolve
 * TenantContextStore at all (PlatformContextStore instead — see
 * platform-context.ts) and platform role codes are a genuinely distinct
 * set (platform_super_admin/support_engineer/billing_administrator/
 * onboarding_specialist) from Chapter 3.2's school-level roles.
 */

import { SetMetadata } from '@nestjs/common';

export const PLATFORM_ROLES_KEY = 'platformRoles';
export const PlatformRoles = (...roles: string[]) => SetMetadata(PLATFORM_ROLES_KEY, roles);
