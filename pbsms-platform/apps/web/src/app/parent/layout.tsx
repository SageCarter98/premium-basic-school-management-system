import { ReactNode } from 'react';

/**
 * Spec §6.3: "No navigation chrome at all on first load." Deliberately
 * NOT wrapped in RequireAuth (@/components/shell/RequireAuth) — there is
 * no login here at all, see use-parent-token.ts and apps/api's
 * tenant.middleware.ts PARENT_PATH_PREFIX branch for how a guardian's
 * request is authenticated instead.
 */
export default function ParentLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
