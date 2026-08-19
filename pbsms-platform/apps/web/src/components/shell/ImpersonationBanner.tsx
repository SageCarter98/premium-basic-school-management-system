'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL } from '@/lib/api-base-url';
import { decodeAccessToken, exitImpersonation, getImpersonationStash } from '@/lib/auth-token-store';
import styles from './ImpersonationBanner.module.css';

/**
 * Spec §8.10 "Impersonation Banner" (TEN-021/022): "full-width, high-
 * contrast, non-dismissible, present on every screen for the duration...
 * The interface must make it impossible to forget you are inside a
 * customer's account." Mounted once in AppShell (not per-page) so it's
 * genuinely impossible to navigate away from — renders nothing when the
 * active session isn't an impersonation token.
 *
 * "End session now" deliberately does NOT just call exitImpersonation()
 * and leave the grant open — it ends the grant server-side first (TEN-021:
 * a support session is time-boxed, not just something the UI stops
 * showing), using the STASHED platform operator's own token, since the
 * currently-active impersonation token has no /v1/platform/* access at
 * all (tenant.middleware.ts refuses an impersonation token on that
 * prefix outright).
 */
export function ImpersonationBanner() {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const claims = decodeAccessToken();
  const stash = getImpersonationStash();
  if (!claims?.impersonationGrantId || !stash) return null;

  const secondsLeft = claims.exp ? Math.max(0, claims.exp * 1000 - now) / 1000 : null;
  const minutesLeft = secondsLeft !== null ? Math.floor(secondsLeft / 60) : null;

  async function handleEnd() {
    setEnding(true);
    try {
      await fetch(`${API_BASE_URL}/v1/platform/impersonation/${claims!.impersonationGrantId}/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${stash!.accessToken}`, 'Content-Type': 'application/json' },
      });
    } catch {
      // best-effort — the grant also self-expires (TEN-021's hard cap), so
      // a failed end-call here doesn't leave a permanently-open session
    } finally {
      exitImpersonation();
      router.push('/platform');
    }
  }

  return (
    <div className={styles.banner} role="alert">
      <span className={styles.label}>SUPPORT SESSION</span>
      <span>{stash.tenantName}</span>
      <span className={styles.dot}>·</span>
      <span>Ticket #{stash.ticketRef}</span>
      <span className={styles.dot}>·</span>
      <span>{minutesLeft !== null ? (minutesLeft > 0 ? `expires in ${minutesLeft} min` : 'expiring now') : ''}</span>
      <span className={styles.dot}>·</span>
      <span>read-only administrator view</span>
      <span className={styles.spacer} />
      <span className={styles.visibleNote}>This session is visible in the school&apos;s audit log.</span>
      <button type="button" className={styles.endButton} onClick={handleEnd} disabled={ending}>
        {ending ? 'Ending…' : 'End session now'}
      </button>
    </div>
  );
}
