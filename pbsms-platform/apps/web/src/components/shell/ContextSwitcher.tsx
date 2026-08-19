'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import styles from './ContextSwitcher.module.css';

interface School {
  id: string;
  name: string;
  code: string;
}

interface AcademicYear {
  id: string;
  name: string;
}

/**
 * Ships with 2 of the spec's 4 context-switcher elements — School and
 * Academic Year — because those are the only two backed by a real table.
 * No `campuses` table and no `terms` table exist anywhere in the schema
 * (verified against all 27 migrations before writing this) — rendering
 * Campus/Term as dropdowns with nothing behind them would be exactly the
 * kind of stub-that-looks-real this codebase avoids elsewhere (stubbed
 * payment methods reject outright rather than pretend to charge a card).
 */
export function ContextSwitcher() {
  const [schools, setSchools] = useState<School[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [yearId, setYearId] = useState('');

  useEffect(() => {
    apiGet<School[]>('/v1/schools')
      .then((data) => {
        setSchools(data);
        if (data[0]) setSchoolId(data[0].id);
      })
      .catch(() => setSchools([]));
    apiGet<AcademicYear[]>('/v1/academic-years')
      .then((data) => {
        setYears(data);
        if (data[0]) setYearId(data[0].id);
      })
      .catch(() => setYears([]));
  }, []);

  const schoolName = schools.find((s) => s.id === schoolId)?.name ?? '…';
  const yearName = years.find((y) => y.id === yearId)?.name ?? '…';

  return (
    <div className={styles.switcher}>
      <select
        className={styles.select}
        aria-label="School"
        value={schoolId}
        onChange={(e) => setSchoolId(e.target.value)}
      >
        {schools.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        aria-label="Academic year"
        value={yearId}
        onChange={(e) => setYearId(e.target.value)}
      >
        {years.map((y) => (
          <option key={y.id} value={y.id}>
            {y.name}
          </option>
        ))}
      </select>
      <span className={styles.summary}>
        {schoolName} · {yearName}
      </span>
    </div>
  );
}
