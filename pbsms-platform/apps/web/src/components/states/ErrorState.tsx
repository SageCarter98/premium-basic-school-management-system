import { ReactNode } from 'react';
import styles from './states.module.css';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  action?: ReactNode;
}

export function ErrorState({ title = 'Something went wrong', message, action }: ErrorStateProps) {
  return (
    <div className={styles.centered} role="alert">
      <div className={styles.errorIcon} aria-hidden="true">✕</div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}
