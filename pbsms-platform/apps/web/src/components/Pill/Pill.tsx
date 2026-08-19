import { HTMLAttributes, ReactNode } from 'react';
import styles from './Pill.module.css';

export type PillVariant = 'success' | 'warning' | 'danger' | 'gold' | 'neutral';

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  variant: PillVariant;
  /**
   * Defaults to a variant-specific glyph. Status must never be conveyed by
   * colour alone (WCAG 1.4.1) — a printed, greyscale report card still
   * needs to read correctly, so every pill pairs colour with a glyph and a
   * word. Pass icon={null} only if the surrounding context already repeats
   * the glyph.
   */
  icon?: ReactNode | null;
  children: ReactNode;
}

const DEFAULT_ICON: Record<PillVariant, string> = {
  success: '✓',
  warning: '◍',
  danger: '✕',
  gold: '★',
  neutral: '◷',
};

const VARIANT_CLASS: Record<PillVariant, string> = {
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
  gold: styles.gold,
  neutral: styles.neutral,
};

export function Pill({ variant, icon, children, className, ...rest }: PillProps) {
  const resolvedIcon = icon === undefined ? DEFAULT_ICON[variant] : icon;
  const classes = [styles.pill, VARIANT_CLASS[variant], className].filter(Boolean).join(' ');
  return (
    <span className={classes} {...rest}>
      {resolvedIcon !== null && <span aria-hidden="true">{resolvedIcon}</span>}
      {children}
    </span>
  );
}
