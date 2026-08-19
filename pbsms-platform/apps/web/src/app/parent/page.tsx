'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { parentApiGet } from '@/lib/parent-api';
import { useParentToken } from '@/lib/use-parent-token';
import { useDataSaver } from '@/lib/use-data-saver';
import styles from './parent.module.css';

interface StudentResult {
  id: string;
  average_percentage: string | null;
  subjects_failed_count: number;
  overall_pass: boolean | null;
  published_at: string | null;
}

interface ParentHomeStudent {
  studentId: string;
  firstName: string;
  lastName: string;
  hasReportAccess: boolean;
  hasFinanceAccess: boolean;
  latestResult: StudentResult | null;
  attendance: { total: number; present: number; absent: number; late: number; percentage: number | null };
  totalBalance: number | null;
  nextDueDate: string | null;
}

function ParentHomeContent() {
  const token = useParentToken();
  const [dataSaver, setDataSaver] = useDataSaver();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [students, setStudents] = useState<ParentHomeStudent[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    parentApiGet<ParentHomeStudent[]>('/v1/parent/home', token)
      .then((rows) => {
        if (cancelled) return;
        setStudents(rows);
        setActiveId(rows[0]?.studentId ?? null);
      })
      .catch(() => {
        if (!cancelled) setError('This link is invalid, expired, or has been revoked — ask the school for a new one.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) {
    return (
      <div className={styles.layout}>
        <div className={styles.content}>
          <ErrorState message="This page needs a valid access link from your child's school." />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.layout}>
        <div className={styles.content}>
          <LoadingState label="Loading" rows={4} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.layout}>
        <div className={styles.content}>
          <ErrorState message={error} />
        </div>
      </div>
    );
  }

  const active = students.find((s) => s.studentId === activeId) ?? students[0];

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.schoolName}>PBSMS</div>
        {students.length > 1 && (
          <div className={styles.childSwitcher}>
            {students.map((s) => (
              <button
                key={s.studentId}
                type="button"
                className={[styles.childTab, s.studentId === activeId ? styles.childTabActive : ''].filter(Boolean).join(' ')}
                onClick={() => setActiveId(s.studentId)}
              >
                {s.firstName}
              </button>
            ))}
          </div>
        )}
      </header>

      {!active ? (
        <div className={styles.content}>
          <ErrorState message="No children are linked to this access link yet." />
        </div>
      ) : (
        <div className={styles.content}>
          {active.hasReportAccess && (
            <Card style={{ padding: 'var(--pb-space-4)' }}>
              {active.latestResult ? (
                <>
                  <p className={styles.cardTitle}>Results are ready</p>
                  <p style={{ color: 'var(--pb-ink-muted)', fontSize: 'var(--pb-text-small)', marginBottom: 'var(--pb-space-3)' }}>
                    Average {active.latestResult.average_percentage ? `${Number(active.latestResult.average_percentage).toFixed(1)}%` : '—'} —{' '}
                    {active.latestResult.overall_pass ? 'Pass' : 'Needs attention'}
                  </p>
                </>
              ) : (
                <p className={styles.cardTitle}>No published results yet</p>
              )}
              {active.latestResult && (
                <Link href={`/parent/students/${active.studentId}/report-card?token=${token}`}>
                  <Button type="button">View report card</Button>
                </Link>
              )}
            </Card>
          )}

          {active.hasFinanceAccess && (
            <Card style={{ padding: 'var(--pb-space-4)' }}>
              <p className={styles.cardTitle}>Balance</p>
              <p className={styles.balanceAmount}>GH₵{(active.totalBalance ?? 0).toFixed(2)}</p>
              {active.nextDueDate && <p className={styles.balanceDue}>due {new Date(active.nextDueDate).toLocaleDateString()}</p>}
              <div className={styles.actionRow}>
                <Button
                  type="button"
                  onClick={() => window.alert('Online payment is not available yet — please pay at the school office.')}
                >
                  Pay now
                </Button>
                <Link href={`/parent/students/${active.studentId}/invoices?token=${token}`}>
                  <Button type="button" variant="secondary">
                    See statement
                  </Button>
                </Link>
              </div>
            </Card>
          )}

          <Card style={{ padding: 'var(--pb-space-4)' }}>
            <div className={styles.attendanceRow}>
              <p className={styles.cardTitle}>Attendance</p>
              <span className={styles.attendancePercent}>{active.attendance.percentage !== null ? `${active.attendance.percentage}%` : '—'}</span>
            </div>
            <p className={styles.attendanceBreakdown}>
              Present {active.attendance.present} · Absent {active.attendance.absent} · Late {active.attendance.late}
            </p>
          </Card>
        </div>
      )}

      <div className={styles.dataSaverRow}>
        <span>Data saver</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--pb-space-1)' }}>
          <input type="checkbox" checked={dataSaver} onChange={(e) => setDataSaver(e.target.checked)} />
          {dataSaver ? 'On' : 'Off'}
        </label>
      </div>
    </div>
  );
}

export default function ParentHomePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading" rows={4} />}>
      <ParentHomeContent />
    </Suspense>
  );
}
