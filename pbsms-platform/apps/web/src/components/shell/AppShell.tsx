'use client';

import { ReactNode, useState } from 'react';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Breadcrumbs } from './Breadcrumbs';
import { ImpersonationBanner } from './ImpersonationBanner';
import styles from './AppShell.module.css';

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const userSub = decodeAccessToken()?.sub ?? '';

  return (
    <div className={styles.layout}>
      {/* Mounted at the outermost level, above the sidebar/topbar chrome —
       * spec §8.10 requires it "present on every screen for the duration,"
       * not scoped to the content area. Renders nothing outside an active
       * impersonation session. */}
      <ImpersonationBanner />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className={styles.main}>
        <Topbar userSub={userSub} onMenuClick={() => setSidebarOpen(true)} />
        <Breadcrumbs />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
