import { ForbiddenException } from '@nestjs/common';

/**
 * DP-100: health and discipline records are excluded from Assistant
 * retrieval by default for EVERY role, even one normally authorised to
 * view them directly. Enforced structurally: a category not listed here
 * cannot be retrieved — there is no per-query opt-out. Adding a health or
 * discipline category later requires a deliberate, separately-reviewed
 * decision, not a query author remembering a rule.
 */
export type AssistantCategory = 'attendance_below_threshold';

export const ASSISTANT_ALLOWED_CATEGORIES: readonly AssistantCategory[] = ['attendance_below_threshold'];

export function assertCategoryAllowed(category: string): asserts category is AssistantCategory {
  if (!(ASSISTANT_ALLOWED_CATEGORIES as readonly string[]).includes(category)) {
    throw new ForbiddenException(
      `Assistant category '${category}' is excluded from retrieval (DP-100 or not yet built).`,
    );
  }
}
