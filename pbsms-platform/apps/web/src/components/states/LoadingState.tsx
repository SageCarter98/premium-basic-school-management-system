import styles from './states.module.css';

export interface LoadingStateProps {
  /** Number of skeleton rows to render. */
  rows?: number;
  /** Screen-reader announcement; not shown visually — the shimmer bars are decorative. */
  label?: string;
}

export function LoadingState({ rows = 3, label = 'Loading' }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite">
      <span className={styles.srOnly}>{label}</span>
      <div className={styles.skeletonGroup} aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={styles.skeletonRow} />
        ))}
      </div>
    </div>
  );
}
