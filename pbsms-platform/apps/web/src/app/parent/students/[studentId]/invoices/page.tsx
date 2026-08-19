'use client';

import { Suspense, use, useEffect, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { parentApiGet } from '@/lib/parent-api';
import { useParentToken } from '@/lib/use-parent-token';
import styles from '../report-card/report-card.module.css';

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  total_amount: string;
  due_date: string | null;
  issued_at: string;
}

interface InvoiceBalance {
  totalAmount: number;
  allocated: number;
  assisted: number;
  balance: number;
  cancelled: boolean;
}

interface InvoiceRow {
  invoice: Invoice;
  balance: InvoiceBalance;
}

function InvoicesContent({ studentId }: { studentId: string }) {
  const token = useParentToken();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<InvoiceRow[]>([]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    parentApiGet<InvoiceRow[]>(`/v1/parent/students/${studentId}/invoices`, token)
      .then((body) => {
        if (!cancelled) setRows(body);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the statement.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, studentId]);

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
        <LoadingState label="Loading statement" rows={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.layout}>
        <ErrorState message={error} />
      </div>
    );
  }

  const totalOutstanding = rows.reduce((sum, r) => sum + r.balance.balance, 0);

  return (
    <div className={styles.layout}>
      <div className={styles.title}>Statement of Account</div>
      <div className={styles.subtitle}>Total outstanding: GH₵{totalOutstanding.toFixed(2)}</div>

      {rows.length === 0 ? (
        <EmptyState title="No invoices" message="Nothing has been invoiced for this student yet." />
      ) : (
        <Card style={{ padding: 'var(--pb-space-4)' }}>
          {rows.map(({ invoice, balance }) => (
            <div key={invoice.id} className={styles.subjectRow}>
              <div>
                <div className={styles.subjectName}>{invoice.invoice_number}</div>
                <div className={styles.gradeText}>
                  {invoice.due_date ? `due ${new Date(invoice.due_date).toLocaleDateString()}` : 'no due date'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div>GH₵{balance.balance.toFixed(2)}</div>
                <Pill variant={balance.balance === 0 ? 'success' : 'warning'}>
                  {balance.cancelled ? 'Cancelled' : balance.balance === 0 ? 'Settled' : 'Outstanding'}
                </Pill>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

export default function InvoicesPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = use(params);
  return (
    <Suspense fallback={<LoadingState label="Loading statement" rows={4} />}>
      <InvoicesContent studentId={studentId} />
    </Suspense>
  );
}
