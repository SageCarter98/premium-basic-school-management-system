'use client';

import { Suspense, use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { parentApiGet } from '@/lib/parent-api';
import { useParentToken } from '@/lib/use-parent-token';
import styles from './report-card.module.css';

interface StudentResult {
  id: string;
  version: number;
  previous_version_id: string | null;
  status: string;
  published_at: string | null;
  average_percentage: string | null;
  subjects_failed_count: number;
  overall_pass: boolean | null;
}

interface StudentResultItem {
  subject_id: string;
  subject_name: string;
  percentage: string;
  grade: string;
  remark: string | null;
  is_pass: boolean;
}

function ReportCardContent({ studentId }: { studentId: string }) {
  const token = useParentToken();
  const searchParams = useSearchParams();
  const resultId = searchParams.get('resultId') ?? undefined;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StudentResult | null>(null);
  const [items, setItems] = useState<StudentResultItem[]>([]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    parentApiGet<{ result: StudentResult; items: StudentResultItem[] }>(
      `/v1/parent/students/${studentId}/report-card`,
      token,
      resultId ? { resultId } : undefined,
    )
      .then((body) => {
        if (cancelled) return;
        setResult(body.result);
        setItems(body.items);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this report card.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, studentId, resultId]);

  if (!token) {
    return (
      <div className={styles.layout}>
        <ErrorState message="This page needs a valid access link from your child's school." />
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.layout}>
        <LoadingState label="Loading report card" rows={5} />
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className={styles.layout}>
        <ErrorState message={error ?? 'Report card not found.'} />
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <div className={styles.title}>Report Card</div>
      <div className={styles.subtitle}>
        Published {result.published_at ? new Date(result.published_at).toLocaleDateString() : '—'} — version {result.version}
      </div>

      {items.length === 0 ? (
        <ErrorState message="No graded subjects on this result yet." />
      ) : (
        <Card style={{ padding: 'var(--pb-space-4)' }}>
          {items.map((item) => (
            <div key={item.subject_id} className={styles.subjectRow}>
              <div>
                <div className={styles.subjectName}>{item.subject_name}</div>
                {item.remark && <div className={styles.gradeText}>{item.remark}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div>{Number(item.percentage).toFixed(1)}%</div>
                <Pill variant={item.is_pass ? 'success' : 'danger'}>{item.grade}</Pill>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card className={styles.summaryCard}>
        <div className={styles.subjectRow} style={{ borderBottom: 'none' }}>
          <strong>Overall average</strong>
          <strong>{result.average_percentage ? `${Number(result.average_percentage).toFixed(1)}%` : '—'}</strong>
        </div>
        <div className={styles.subjectRow} style={{ borderBottom: 'none' }}>
          <span>Overall result</span>
          <Pill variant={result.overall_pass ? 'success' : 'danger'}>{result.overall_pass ? 'Pass' : 'Needs attention'}</Pill>
        </div>
      </Card>

      {result.previous_version_id && (
        <p className={styles.versionNote}>
          This result was revised.{' '}
          <Link href={`/parent/students/${studentId}/report-card?resultId=${result.previous_version_id}&token=${token}`}>
            View the previous version
          </Link>
          .
        </p>
      )}

      <div className={styles.noPrint} style={{ marginTop: 'var(--pb-space-4)' }}>
        <Button type="button" variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
      </div>
    </div>
  );
}

export default function ReportCardPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = use(params);
  return (
    <Suspense fallback={<LoadingState label="Loading report card" rows={5} />}>
      <ReportCardContent studentId={studentId} />
    </Suspense>
  );
}
