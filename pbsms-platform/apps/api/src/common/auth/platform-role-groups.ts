/**
 * platform-role-groups.ts — named platform role-code tiers (Chapter 3.1),
 * the platform-side equivalent of role-groups.ts. Only PLATFORM_SUPER_ADMIN
 * can grant/revoke platform roles (Chapter 3.1: "break-glass access only").
 * PLATFORM_ONBOARDING/PLATFORM_BILLING compose per-controller rather than
 * repeating role arrays, same reasoning as role-groups.ts.
 */

export const PLATFORM_SUPER_ADMIN = ['platform_super_admin'];

// Onboarding Specialist: "set up new tenants, run seed data and initial
// configuration" (Chapter 3.1) — can create tenants and drive them through
// the trial->onboarding->active transitions.
export const PLATFORM_ONBOARDING = [...PLATFORM_SUPER_ADMIN, 'onboarding_specialist'];

// Billing Administrator: "manage subscriptions... dunning" (Chapter 3.1) —
// FR-BIL-040's dunning sequence drives active->past_due->suspended, so
// this tier can also call transition() even though it can't create tenants.
export const PLATFORM_BILLING = [...PLATFORM_SUPER_ADMIN, 'billing_administrator'];

// Every transition this pass' TenantsService supports can plausibly be
// driven by either onboarding or billing workflows (a Support Engineer
// investigating a ticket needs the same transition capability too, per
// Chapter 3.1's "diagnose and resolve tenant-reported issues") — rather
// than split hairs over exactly which of the 4 roles owns which specific
// transition (a distinction the SRS doesn't draw either), all 4 platform
// roles can call transition()/read tenant data; only create() is
// restricted to the two roles whose stated purpose is bringing a new
// tenant into existence.
export const PLATFORM_ALL = [...PLATFORM_SUPER_ADMIN, 'support_engineer', 'billing_administrator', 'onboarding_specialist'];
