'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { ErrorState } from '@/components/states/ErrorState';
import { ApiError, apiFetch, login } from '@/lib/api-client';
import { decodeAccessToken, setTokens } from '@/lib/auth-token-store';
import styles from './login.module.css';

/**
 * Real MFA sign-in, built Stage 9 (Platform Console can never be reached
 * without it — every platform login is unconditionally MFA-gated,
 * SEC-030). Stages 2-8 left this as an honest "not built yet" message
 * since every tenant account that needed it (LEADERSHIP-tier only) had a
 * non-MFA account to fall back to for testing; Platform Console has no
 * such fallback, so this was the actual prerequisite, not a nice-to-have.
 * No QR-code rendering (no image tooling in this environment, same
 * limitation Stage 3's PWA icons already hit) — the secret and its
 * otpauth:// URI are shown as copyable text for a real authenticator app
 * to add by manual entry.
 */
type Step =
  | { kind: 'credentials' }
  | { kind: 'verify'; challengeToken: string }
  | { kind: 'enroll-loading' }
  | { kind: 'enroll'; secret: string; otpauthUrl: string };

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = body?.message;
  return (Array.isArray(m) ? m.join('; ') : m) ?? fallback;
}

function redirectAfterAuth(router: ReturnType<typeof useRouter>) {
  const claims = decodeAccessToken();
  router.push(claims?.isPlatformUser ? '/platform' : '/dashboard');
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCredentials(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await login(email, password);
      if ('mfaRequired' in result) {
        setStep({ kind: 'verify', challengeToken: result.challengeToken });
        return;
      }
      if ('mfaSetupRequired' in result) {
        // The bootstrap token is scoped to exactly the two enroll/enable
        // endpoints server-side (tenant.middleware.ts's MFA_SETUP_PATHS) —
        // setting it as the active token now is what lets apiFetch below
        // carry it, not a full session yet.
        setTokens(result.accessToken);
        setStep({ kind: 'enroll-loading' });
        const enrollRes = await apiFetch('/v1/auth/mfa/enroll', { method: 'POST' });
        if (!enrollRes.ok) {
          setError('Could not start MFA enrollment. Try signing in again.');
          setStep({ kind: 'credentials' });
          return;
        }
        const enrollment = (await enrollRes.json()) as { secret: string; otpauthUrl: string };
        setStep({ kind: 'enroll', secret: enrollment.secret, otpauthUrl: enrollment.otpauthUrl });
        return;
      }
      setTokens(result.accessToken, result.refreshToken);
      redirectAfterAuth(router);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Incorrect email or password.');
      } else {
        setError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: FormEvent, challengeToken: string) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/v1/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ challengeToken, code }) });
      if (!res.ok) {
        setError(res.status === 401 ? 'Incorrect code. Check your authenticator app and try again.' : await errorMessage(res, `Failed (${res.status})`));
        return;
      }
      const body = (await res.json()) as { accessToken: string; refreshToken: string };
      setTokens(body.accessToken, body.refreshToken);
      redirectAfterAuth(router);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEnable(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/v1/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) });
      if (!res.ok) {
        setError(res.status === 401 ? 'Incorrect code. Check your authenticator app and try again.' : await errorMessage(res, `Failed (${res.status})`));
        return;
      }
      const body = (await res.json()) as { accessToken: string; refreshToken: string };
      setTokens(body.accessToken, body.refreshToken);
      redirectAfterAuth(router);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <h1 className={styles.title}>PBSMS</h1>
        <p className={styles.subtitle}>
          {step.kind === 'credentials' && 'Sign in to your school account'}
          {step.kind === 'verify' && 'Enter your 6-digit authenticator code'}
          {(step.kind === 'enroll-loading' || step.kind === 'enroll') && 'Set up multi-factor sign-in'}
        </p>

        {error && (
          <div className={styles.errorSlot}>
            <ErrorState title="Couldn't sign in" message={error} />
          </div>
        )}

        {step.kind === 'credentials' && (
          <form onSubmit={handleCredentials}>
            <div className={styles.field}>
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" variant="primary" className={styles.submit} disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        )}

        {step.kind === 'credentials' && (
          <>
            <p className={styles.subtitle} style={{ marginTop: 'var(--pb-space-4)', marginBottom: 0, textAlign: 'center' }}>
              Parent or guardian without a link yet? <Link href="/request-guardian-access">Request access</Link>
            </p>
            <p className={styles.subtitle} style={{ marginTop: 'var(--pb-space-2)', marginBottom: 0, textAlign: 'center' }}>
              New school? <Link href="/apply-tenant">Apply for an account</Link>
            </p>
          </>
        )}

        {step.kind === 'verify' && (
          <form onSubmit={(e) => handleVerify(e, step.challengeToken)}>
            <div className={styles.field}>
              <label htmlFor="code">Authenticator code</label>
              <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <Button type="submit" variant="primary" className={styles.submit} disabled={submitting || code.length !== 6}>
              {submitting ? 'Verifying…' : 'Verify'}
            </Button>
          </form>
        )}

        {step.kind === 'enroll-loading' && <p className={styles.subtitle}>Starting enrollment…</p>}

        {step.kind === 'enroll' && (
          <form onSubmit={handleEnable}>
            <p className={styles.subtitle}>
              Add this account to your authenticator app (scan not supported here — enter the secret manually), then enter the 6-digit code it produces.
            </p>
            <div className={styles.field}>
              <label htmlFor="secret">Setup key</label>
              <input id="secret" readOnly value={step.secret} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <div className={styles.field}>
              <label htmlFor="otpauth">Setup URI (for apps that accept manual entry)</label>
              <input id="otpauth" readOnly value={step.otpauthUrl} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <div className={styles.field}>
              <label htmlFor="code">Authenticator code</label>
              <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <Button type="submit" variant="primary" className={styles.submit} disabled={submitting || code.length !== 6}>
              {submitting ? 'Confirming…' : 'Confirm and sign in'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
