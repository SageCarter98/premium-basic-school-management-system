'use client';

import { ReactNode } from 'react';
import { RequireAuth } from '@/components/shell/RequireAuth';
import { TeacherShell } from '@/components/teacher-shell/TeacherShell';
import { RestrictedState } from '@/components/states/RestrictedState';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { ACADEMIC_STAFF, hasAnyRole } from '@/lib/role-groups';

/**
 * Mirrors src/app/(shell)/layout.tsx's structure (RequireAuth wraps the
 * shell chrome, not the other way around, so a signed-out visitor never
 * mounts the shell only to be redirected away from it) but with
 * `TeacherShell` instead of `AppShell` — spec §6.2's genuinely separate
 * Teacher Field App shell, not a variant of the Staff Console one.
 *
 * Role check added here, not inside TeacherShell — a non-ACADEMIC_STAFF
 * account (e.g. accountant navigating straight to /teacher) previously
 * hit an unhandled 403 crash from TeacherShell's own staff-lookup fetch,
 * since nothing gated the shell from mounting for a role it wasn't built
 * for. Gating before TeacherShell mounts at all avoids repeating that.
 */
export default function TeacherLayout({ children }: { children: ReactNode }) {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];

  return (
    <RequireAuth>
      {hasAnyRole(roleCodes, ACADEMIC_STAFF) ? (
        <TeacherShell>{children}</TeacherShell>
      ) : (
        <div style={{ padding: 'var(--pb-space-6)' }}>
          <RestrictedState message="The Teacher Field App is available to teaching and academic-office staff only." />
        </div>
      )}
    </RequireAuth>
  );
}
