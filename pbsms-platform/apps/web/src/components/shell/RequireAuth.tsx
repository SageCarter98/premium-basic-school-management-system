'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { decodeAccessToken, hasSession } from '@/lib/auth-token-store';
import { LoadingState } from '@/components/states/LoadingState';

/**
 * Client-side route guard — Next.js middleware runs at the edge and can't
 * read localStorage, so this has to be a mount-time check + redirect
 * rather than the "obvious" middleware-first instinct (Stage 2 plan,
 * decision 4). Renders nothing but a loading state until the check
 * resolves, so protected content never flashes before a redirect fires.
 *
 * Also refuses a real, valid PLATFORM session from ever reaching tenant
 * shell screens — the inverse of RequirePlatformAuth.tsx's own check.
 * LoginForm.tsx's redirectAfterAuth() already sends a platform user to
 * /platform on fresh login, but that alone doesn't cover every way a
 * (shell) route can be reached with a platform token still active
 * (bookmark, browser back, a stale tab) — without this, that platform
 * token renders AppShell's tenant chrome, whose ContextSwitcher then
 * fires tenant-scoped calls that always 401 for a platform actor (by
 * design, tenant.middleware.ts never resolves a tenant context for one).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }
    if (decodeAccessToken()?.isPlatformUser === true) {
      router.replace('/platform');
      return;
    }
    setChecked(true);
  }, [router]);

  if (!checked) {
    return (
      <div style={{ padding: 'var(--pb-space-6)' }}>
        <LoadingState label="Checking your session" />
      </div>
    );
  }

  return <>{children}</>;
}
