'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { hasSession } from '@/lib/auth-token-store';

/**
 * Stage 2 replaces the Stage 1 "proves the app boots" placeholder with a
 * real entry redirect — a signed-in visitor goes straight to the shell,
 * a signed-out one goes to /login. No content renders here itself.
 */
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(hasSession() ? '/dashboard' : '/login');
  }, [router]);

  return null;
}
