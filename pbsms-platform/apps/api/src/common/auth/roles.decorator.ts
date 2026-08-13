/**
 * roles.decorator.ts — Chapter 13.2. Marks a route handler with the
 * role_codes allowed to call it; RolesGuard (roles.guard.ts) reads this
 * metadata. A handler with NO @Roles() is unrestricted by role (still
 * subject to tenant isolation via RLS regardless) — this is deliberate so
 * every module built before this pass keeps working unchanged, and each
 * module gets retrofitted with real @Roles() one pass at a time, same
 * discipline as everything else in this codebase.
 */

import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
