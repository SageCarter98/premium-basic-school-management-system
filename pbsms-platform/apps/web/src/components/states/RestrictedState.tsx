import styles from './states.module.css';

export interface RestrictedStateProps {
  title?: string;
  message?: string;
}

export function RestrictedState({
  title = "You don't have access to this",
  message,
}: RestrictedStateProps) {
  const classes = [styles.centered, styles.restricted].join(' ');
  return (
    <div className={classes}>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
    </div>
  );
}
