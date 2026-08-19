import { HTMLAttributes } from 'react';
import styles from './Card.module.css';

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...rest }: CardProps) {
  const classes = [styles.card, className].filter(Boolean).join(' ');
  return <div className={classes} {...rest} />;
}
