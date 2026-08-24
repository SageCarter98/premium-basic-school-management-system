'use client';

import { FormEvent, useState } from 'react';
import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { ErrorState } from '@/components/states/ErrorState';
import { apiFetch } from '@/lib/api-client';
import styles from './request-guardian-access.module.css';

/**
 * Public, unauthenticated (tenant.middleware.ts's PUBLIC_PATHS covers
 * exactly POST /v1/guardian-access-requests/submit — see that file's own
 * header). The guardian self-request flow closing the "nothing lets a
 * guardian who was never contacted first ask for a link" gap — see
 * 0043_guardian_access_requests.sql's header for why the school code +
 * admission number (both already on real physical documents a guardian
 * would have) is how this resolves which school/student the request is
 * for, with no login and no tenant context.
 */
export default function RequestGuardianAccessPage() {
  const [form, setForm] = useState({
    schoolCode: '',
    admissionNo: '',
    requesterName: '',
    requesterPhone: '',
    requesterEmail: '',
    relationship: '',
    message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/v1/guardian-access-requests/submit', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          requesterPhone: form.requesterPhone || undefined,
          requesterEmail: form.requesterEmail || undefined,
          relationship: form.relationship || undefined,
          message: form.message || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
        const m = body?.message;
        throw new Error((Array.isArray(m) ? m.join('; ') : m) ?? `Failed (${res.status})`);
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your request.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className={styles.page}>
        <Card className={styles.card}>
          <div className={styles.successBox}>
            <h1 className={styles.title}>Request sent</h1>
            <p className={styles.subtitle}>
              The school has been notified. They will review your request and, once approved, send you a link to view
              your child&apos;s information.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <h1 className={styles.title}>Request guardian access</h1>
        <p className={styles.subtitle}>
          If you weren&apos;t already sent a link by the school, use this form to request one. You&apos;ll need your
          child&apos;s school code and admission number — both are on their admission letter or report card.
        </p>
        {error && (
          <div className={styles.errorSlot}>
            <ErrorState message={error} />
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="schoolCode">School code</label>
              <input
                id="schoolCode"
                required
                value={form.schoolCode}
                onChange={(e) => setForm({ ...form, schoolCode: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="admissionNo">Child&apos;s admission number</label>
              <input
                id="admissionNo"
                required
                value={form.admissionNo}
                onChange={(e) => setForm({ ...form, admissionNo: e.target.value })}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label htmlFor="requesterName">Your full name</label>
            <input
              id="requesterName"
              required
              value={form.requesterName}
              onChange={(e) => setForm({ ...form, requesterName: e.target.value })}
            />
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="requesterPhone">Your phone (optional)</label>
              <input
                id="requesterPhone"
                value={form.requesterPhone}
                onChange={(e) => setForm({ ...form, requesterPhone: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="requesterEmail">Your email (optional)</label>
              <input
                id="requesterEmail"
                type="email"
                value={form.requesterEmail}
                onChange={(e) => setForm({ ...form, requesterEmail: e.target.value })}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label htmlFor="relationship">Relationship to the student (e.g. mother, father, guardian)</label>
            <input
              id="relationship"
              value={form.relationship}
              onChange={(e) => setForm({ ...form, relationship: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="message">Message to the school (optional)</label>
            <textarea id="message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </div>
          <Button
            type="submit"
            className={styles.submit}
            disabled={submitting || !form.schoolCode || !form.admissionNo || !form.requesterName}
          >
            {submitting ? 'Sending…' : 'Send request'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
