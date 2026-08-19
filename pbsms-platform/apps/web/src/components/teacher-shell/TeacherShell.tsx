'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { apiGet } from '@/lib/api-client';
import { subscribeScoreSyncState, subscribeSyncState } from '@/lib/offline-sync';
import styles from './TeacherShell.module.css';

const NAV_ITEMS = [
  { href: '/teacher', label: 'Today' },
  { href: '/teacher/register', label: 'Register' },
  { href: '/teacher/scores', label: 'Scores' },
  { href: '/teacher/more', label: 'More' },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Spec §6.2 — a genuinely separate shell from the Staff Console's
 * `AppShell`, not a mobile variant of it: no sidebar, four bottom-nav
 * destinations, capped to a one-handed-width column (see the CSS module).
 * The "N unsynced" top-bar badge combines BOTH offline queues
 * (attendance + scores, Stage 3 + Stage 4) into one number, matching the
 * mockup — a teacher shouldn't have to check two different counters to
 * know whether anything is still stuck on the phone.
 */
export function TeacherShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const tenantId = decodeAccessToken()?.tenantId ?? null;
  const [firstName, setFirstName] = useState('');
  const [attendanceUnsynced, setAttendanceUnsynced] = useState(0);
  const [scoreUnsynced, setScoreUnsynced] = useState(0);

  useEffect(() => {
    const sub = decodeAccessToken()?.sub;
    if (!sub) return;
    apiGet<{ full_name: string }>(`/v1/staff/${sub}`)
      .then((staff) => setFirstName(staff.full_name.split(' ')[0] ?? ''))
      .catch(() => {
        // Name is decorative — the greeting just drops it, no error state needed.
      });
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    const unsubAttendance = subscribeSyncState(tenantId, (s) =>
      setAttendanceUnsynced(s.pendingCount + s.sendingCount + s.failedCount),
    );
    const unsubScore = subscribeScoreSyncState(tenantId, (s) =>
      setScoreUnsynced(s.pendingCount + s.sendingCount + s.failedCount),
    );
    return () => {
      unsubAttendance();
      unsubScore();
    };
  }, [tenantId]);

  const totalUnsynced = attendanceUnsynced + scoreUnsynced;

  return (
    <div className={styles.layout}>
      <header className={styles.topBar}>
        <span>
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </span>
        {totalUnsynced > 0 && (
          <span className={styles.unsyncedBadge}>
            {totalUnsynced} unsynced
          </span>
        )}
      </header>
      <main className={styles.content}>{children}</main>
      <nav className={styles.bottomNav} aria-label="Teacher Field App navigation">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={[styles.navItem, pathname === item.href ? styles.navItemActive : ''].filter(Boolean).join(' ')}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
