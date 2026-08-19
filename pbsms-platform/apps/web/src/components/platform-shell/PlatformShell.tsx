'use client';

import { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { logout } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import styles from './PlatformShell.module.css';

/**
 * Spec §6.4: "Every screen states which tenant is in view, in a
 * persistent bar that is visually distinct from the tenant-facing
 * product (dark, unmistakable) so PBSMS staff can never confuse the
 * console with a customer's own account." This bar covers the
 * "unmistakable dark console" half; the per-tenant "which tenant is in
 * view" half is shown inline where a tenant is actually being viewed
 * (the Tenants tab's detail panel), not duplicated up here as a global
 * placeholder when browsing the tenant LIST has no single tenant in view
 * at all — a documented simplification, same category as Analytics'
 * School Performance tab collapsing two spec screens into one real
 * endpoint.
 */
export function PlatformShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div className={styles.layout}>
      <header className={styles.topbar}>
        <span className={styles.logo}>PBSMS Platform Console</span>
        <span className={styles.roleBadge}>{roleCodes.join(', ') || 'no platform role'}</span>
        <div className={styles.spacer} />
        <button type="button" className={styles.signOut} onClick={handleLogout}>
          Sign out
        </button>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
