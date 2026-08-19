'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const STORAGE_KEY = 'pbsms.parentToken';

/**
 * Reads the guardian's access token from `?token=` on first arrival (the
 * WhatsApp-link entry point, spec §8.6) and mirrors it into sessionStorage
 * so internal navigation (View report card, See statement) doesn't need
 * to thread the token through every link's query string by hand.
 * sessionStorage, not localStorage — cleared when the tab closes, which
 * matters more here than for a staff session: a shared family device may
 * carry a different guardian's link at a different time.
 */
export function useParentToken(): string | null {
  const searchParams = useSearchParams();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = searchParams.get('token');
    if (fromUrl) {
      sessionStorage.setItem(STORAGE_KEY, fromUrl);
      setToken(fromUrl);
    } else {
      setToken(sessionStorage.getItem(STORAGE_KEY));
    }
  }, [searchParams]);

  return token;
}
