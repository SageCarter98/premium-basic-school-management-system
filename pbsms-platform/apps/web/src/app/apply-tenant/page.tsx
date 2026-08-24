'use client';

import { FormEvent, useState } from 'react';
import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { ErrorState } from '@/components/states/ErrorState';
import { apiFetch } from '@/lib/api-client';
import styles from './apply-tenant.module.css';

/**
 * Public, unauthenticated (tenant.middleware.ts's PUBLIC_PATHS covers
 * exactly POST /v1/tenant-applications/submit). Closes "Tenant can sign
 * up via login portal if new to apply and Platform-Admin should be
 * capable to accept tenant" — see 0045_tenant_applications.sql's header
 * for the full design (modeled on Admissions' applicant pattern, not a
 * new tenant-lifecycle state). A platform admin reviews this from the
 * Platform Console's Applications tab; approving creates the real
 * tenant and this contact's own admin account in one action.
 */
export default function ApplyTenantPage() {
  const [form, setForm] = useState({
    schoolName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    address: '',
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
      const res = await apiFetch('/v1/tenant-applications/submit', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          contactPhone: form.contactPhone || undefined,
          address: form.address || undefined,
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
      setError(err instanceof Error ? err.message : 'Could not submit your application.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className={styles.page}>
        <Card className={styles.card}>
          <div className={styles.successBox}>
            <h1 className={styles.title}>Application sent</h1>
            <p className={styles.subtitle}>
              Thank you. Our team will review your application and reach out with a link to set your password and
              get started once it&apos;s approved.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <h1 className={styles.title}>Apply for a PBSMS account</h1>
        <p className={styles.subtitle}>New to PBSMS? Tell us about your school and we&apos;ll get you set up.</p>
        {error && (
          <div className={styles.errorSlot}>
            <ErrorState message={error} />
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="schoolName">School name</label>
            <input id="schoolName" required value={form.schoolName} onChange={(e) => setForm({ ...form, schoolName: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label htmlFor="contactName">Your full name</label>
            <input id="contactName" required value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="contactEmail">Your email</label>
              <input
                id="contactEmail"
                type="email"
                required
                value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="contactPhone">Your phone (optional)</label>
              <input id="contactPhone" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
            </div>
          </div>
          <div className={styles.field}>
            <label htmlFor="address">School address (optional)</label>
            <input id="address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label htmlFor="message">Anything else we should know? (optional)</label>
            <textarea id="message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </div>
          <Button
            type="submit"
            className={styles.submit}
            disabled={submitting || !form.schoolName || !form.contactName || !form.contactEmail}
          >
            {submitting ? 'Sending…' : 'Send application'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
