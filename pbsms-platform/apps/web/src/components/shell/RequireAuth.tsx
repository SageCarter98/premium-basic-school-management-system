'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hasSession } from '@/lib/auth-token-store';
import { LoadingState } from '@/components/states/LoadingState';

/**
 * Client-side route guard — Next.js middleware runs at the edge and can't
 * read localStorage, so this has to be a mount-time check + redirect
 * rather than the "obvious" middleware-first instinct (Stage 2 plan,
 * decision 4). Renders nothing but a loading state until the check
 * resolves, so protected content never flashes before a redirect fires.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!hasSession()) {
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
