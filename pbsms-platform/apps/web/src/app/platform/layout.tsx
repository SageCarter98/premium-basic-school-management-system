import { ReactNode } from 'react';
import { RequirePlatformAuth } from '@/components/platform-shell/RequirePlatformAuth';
import { PlatformShell } from '@/components/platform-shell/PlatformShell';

/**
 * Spec §6.4 — Platform Console is a fourth, genuinely separate shell
 * (after Staff Console, Teacher Field App, Parent View), reached only by
 * a real `isPlatformUser` session. Mirrors `(teacher)/layout.tsx`'s
 * guard-wraps-shell structure with `RequirePlatformAuth`/`PlatformShell`
 * instead.
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <RequirePlatformAuth>
      <PlatformShell>{children}</PlatformShell>
    </RequirePlatformAuth>
  );
}
