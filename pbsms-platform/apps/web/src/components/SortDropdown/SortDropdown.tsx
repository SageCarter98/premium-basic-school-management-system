'use client';

import styles from './SortDropdown.module.css';

export interface SortOption {
  value: string;
  label: string;
}

/**
 * A plain field+direction picker for client-side list sorting — every
 * list view in apps/web already filters client-side over a small
 * tenant-wide dataset (see e.g. students/page.tsx's own search/filter
 * comment), so sorting fits the same posture: no new backend endpoint,
 * just a `.sort()` over the already-loaded array.
 */
export function SortDropdown({
  options,
  value,
  direction,
  onChange,
}: {
  options: SortOption[];
  value: string;
  direction: 'asc' | 'desc';
  onChange: (value: string, direction: 'asc' | 'desc') => void;
}) {
  return (
    <span className={styles.wrap}>
      <label className={styles.label} htmlFor="sort-field">
        Sort by
      </label>
      <select id="sort-field" className={styles.select} value={value} onChange={(e) => onChange(e.target.value, direction)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.direction}
        aria-label={direction === 'asc' ? 'Sort ascending' : 'Sort descending'}
        onClick={() => onChange(value, direction === 'asc' ? 'desc' : 'asc')}
      >
        {direction === 'asc' ? '↑' : '↓'}
      </button>
    </span>
  );
}
