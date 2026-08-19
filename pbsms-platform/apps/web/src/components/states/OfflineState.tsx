import { ReactNode } from 'react';
import styles from './states.module.css';

export interface OfflineStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  action?: ReactNode;
}

/**
 * Persistent connectivity banner (spec §8.2, "SyncLedger") — offline never
 * blocks the content underneath from rendering, it just tells the user
 * their work is queued on-device. Not a full-page state like the other four.
 */
export function OfflineState({ message, actionLabel, onAction, action }: OfflineStateProps) {
  return (
    <div className={styles.offlineBanner} role="status" aria-live="polite">
      <span className={styles.glyph} aria-hidden="true">◍</span>
      <span>{message}</span>
      {action}
      {!action && actionLabel && (
        <button type="button" className={styles.offlineAction} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
