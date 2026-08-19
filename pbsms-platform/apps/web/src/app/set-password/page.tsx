'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { ErrorState } from '@/components/states/ErrorState';
import { LoadingState } from '@/components/states/LoadingState';
import { apiFetch } from '@/lib/api-client';
import styles from './set-password.module.css';

/**
 * Public, unauthenticated (tenant.middleware.ts's PUBLIC_PATHS already
 * covers POST /v1/auth/password-reset/confirm — no frontend page called
 * it before this one). Serves two real flows through the same real
 * backend endpoint: a staff member claiming an invite (staff.service.ts's
 * inviteStaff()) and an existing user completing a forgot-password reset
 * — the token doesn't distinguish between the two, and neither does this
 * page.
 */
function SetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/v1/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'That link is invalid or has expired.');
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set your password.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className={styles.page}>
        <Card className={styles.card}>
          <h1 className={styles.title}>PBSMS</h1>
          <ErrorState message="This link is missing its token — check you copied the full URL." />
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className={styles.page}>
        <Card className={styles.card}>
          <h1 className={styles.title}>Password set</h1>
          <p className={styles.subtitle}>You can now sign in with your new password.</p>
          <Button type="button" className={styles.submit} onClick={() => router.push('/login')}>
            Go to sign in
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <h1 className={styles.title}>Set your password</h1>
        <p className={styles.subtitle}>Choose a password for your PBSMS account.</p>
        {error && (
          <div className={styles.errorSlot}>
            <ErrorState title="Couldn't set password" message={error} />
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="password">New password</label>
            <input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="confirm">Confirm password</label>
            <input id="confirm" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button type="submit" variant="primary" className={styles.submit} disabled={submitting}>
            {submitting ? 'Setting password…' : 'Set password'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading" />}>
      <SetPasswordContent />
    </Suspense>
  );
}
