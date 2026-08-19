'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button/Button';
import { logout } from '@/lib/api-client';
import { ContextSwitcher } from './ContextSwitcher';
import styles from './Topbar.module.css';

export function Topbar({ userSub, onMenuClick }: { userSub: string; onMenuClick: () => void }) {
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <header className={styles.topbar}>
      <button
        type="button"
        className={styles.menuButton}
        aria-label="Open navigation menu"
        onClick={onMenuClick}
      >
        ☰
      </button>
      <span className={styles.logo}>PBSMS</span>
      <ContextSwitcher />
      <div className={styles.spacer} />
      <div className={styles.userMenu}>
        <span className={styles.userName}>{userSub}</span>
        <Button variant="secondary" onClick={handleLogout}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
