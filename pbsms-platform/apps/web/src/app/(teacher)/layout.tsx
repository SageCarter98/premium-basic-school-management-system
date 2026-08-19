import { ReactNode } from 'react';
import { RequireAuth } from '@/components/shell/RequireAuth';
import { TeacherShell } from '@/components/teacher-shell/TeacherShell';

/**
 * Mirrors src/app/(shell)/layout.tsx's structure (RequireAuth wraps the
 * shell chrome, not the other way around, so a signed-out visitor never
 * mounts the shell only to be redirected away from it) but with
 * `TeacherShell` instead of `AppShell` — spec §6.2's genuinely separate
 * Teacher Field App shell, not a variant of the Staff Console one.
 */
export default function TeacherLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <TeacherShell>{children}</TeacherShell>
    </RequireAuth>
  );
}
