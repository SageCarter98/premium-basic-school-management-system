'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { decodeAccessToken, hasSession } from '@/lib/auth-token-store';
import { LoadingState } from '@/components/states/LoadingState';

/**
 * Platform Console's own route guard — mirrors RequireAuth.tsx's shape
 * exactly (client-side mount-time check, Next.js middleware can't read
 * localStorage), but additionally refuses a real, valid TENANT session
 * from ever reaching Platform Console screens. A tenant admin's token has
 * `isPlatformUser: false` — without this second check, RequireAuth's bare
 * `hasSession()` alone would let any signed-in tenant user's browser
 * render `/platform`'s content briefly before any API call 403'd, which
 * is the exact "UI declutters, server decides" posture inverted the wrong
 * way for a console this sensitive.
 */
export function RequirePlatformAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!hasSession() || decodeAccessToken()?.isPlatformUser !== true) {
      router.replace('/login');
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
