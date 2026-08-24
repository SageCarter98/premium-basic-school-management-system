'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { NAV_CONFIG } from '@/lib/nav-config';
import { hasAnyRole } from '@/lib/role-groups';
import { useSidebarCollapsed } from '@/lib/use-sidebar-collapsed';
import styles from './Sidebar.module.css';

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const [collapsed, setCollapsed] = useSidebarCollapsed();

  const visibleGroups = NAV_CONFIG.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasAnyRole(roleCodes, item.requiredRoles)),
  })).filter((group) => group.items.length > 0);

  const sidebarClass = [styles.sidebar, open ? styles.sidebarOpen : '', collapsed ? styles.sidebarCollapsed : '']
    .filter(Boolean)
    .join(' ');
  const backdropClass = [styles.backdrop, open ? styles.backdropVisible : ''].filter(Boolean).join(' ');

  return (
    <>
      <div className={backdropClass} onClick={onClose} aria-hidden="true" />
      <nav className={sidebarClass} aria-label="Main navigation">
        <button
          type="button"
          className={styles.collapseToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? '»' : '« Collapse'}
        </button>
        <div className={styles.group}>
          <div className={styles.groupLabel}>Home</div>
          <Link
            href="/dashboard"
            className={[styles.item, pathname === '/dashboard' ? styles.itemActive : ''].join(' ')}
            onClick={onClose}
          >
            <span className={styles.itemLabel}>Dashboard</span>
          </Link>
        </div>
        {visibleGroups.map((group) => (
          <div key={group.label} className={styles.group}>
            <div className={styles.groupLabel}>{group.label}</div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={[styles.item, pathname === item.href ? styles.itemActive : ''].join(' ')}
                onClick={onClose}
              >
                <span className={styles.itemLabel}>{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}
