import { ReactNode } from 'react';
import { RequireAuth } from '@/components/shell/RequireAuth';
import { AppShell } from '@/components/shell/AppShell';

/**
 * Every authenticated route lives inside this route group — `/login`
 * stays outside it entirely, so a signed-out visitor never mounts the
 * shell chrome only to be redirected away from it.
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
