/**
 * sensitive-action.decorator.ts — marks a handler as one of TEN-021's
 * three named sensitive actions ("financial reversal, data export, or
 * permission changes") that an IMPERSONATION session may not perform
 * without a second platform approver. Read by
 * ImpersonationSensitiveActionGuard. A no-op for ordinary (non-
 * impersonated) requests — a real tenant admin performing a reversal is
 * unaffected; this only constrains what a Support Engineer can do while
 * impersonating.
 */

import { SetMetadata } from '@nestjs/common';

export const SENSITIVE_ACTION_KEY = 'sensitiveAction';
export type SensitiveActionType = 'financial_reversal' | 'data_export' | 'permission_change';
export const SensitiveAction = (actionType: SensitiveActionType) => SetMetadata(SENSITIVE_ACTION_KEY, actionType);
