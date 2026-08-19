'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_CONFIG } from '@/lib/nav-config';
import styles from './Breadcrumbs.module.css';

/**
 * Staff Console + Platform Console pattern only (§6.1) — Teacher Field App
 * and Parent View use a back arrow instead, since those surfaces are
 * shallow by design (a later stage's shell, not this one). Hidden on
 * `/dashboard` itself since breadcrumbs only appear "more than one level
 * deep" — the real 3-level trail the spec shows ("Students › JHS 2A › Ama
 * Mensah") needs hierarchical routes that don't exist until Stage 5; this
 * stage's 2-level trail (Dashboard › Students) still proves the mechanism.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  if (pathname === '/dashboard') return null;

  const allItems = NAV_CONFIG.flatMap((g) => g.items);
  const current = allItems.find((item) => item.href === pathname);
  const label = current?.label ?? pathname;

  return (
    <nav className={styles.crumbs} aria-label="Breadcrumb">
      <Link href="/dashboard">Dashboard</Link>
      <span className={styles.sep} aria-hidden="true">
        ›
      </span>
      <span className={styles.current}>{label}</span>
    </nav>
  );
}
