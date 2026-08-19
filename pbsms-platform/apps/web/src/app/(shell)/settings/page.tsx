'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { apiFetch, apiGet } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { ACADEMIC_ADMIN, hasAnyRole } from '@/lib/role-groups';
import styles from '@/styles/tab-hub.module.css';

interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  role_codes: string[];
}

const ROLE_OPTIONS = [
  'proprietor',
  'administrator',
  'headmaster',
  'assistant_headmaster',
  'academic_coordinator',
  'examination_officer',
  'admission_officer',
  'teacher',
  'accountant',
  'librarian',
  'transport_officer',
  'health_officer',
  'storekeeper',
];

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = body?.message;
  return (Array.isArray(m) ? m.join('; ') : m) ?? fallback;
}

/**
 * Settings — currently just Staff (directory + invite). Real screens
 * start Stage 4 per spec §13; this replaces the Stage-2-era stub now
 * that staff.service.ts's inviteStaff() closes what used to be a
 * "read-only, invite is a separate concern" deferral.
 */
export default function SettingsPage() {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canInvite = hasAnyRole(roleCodes, ACADEMIC_ADMIN);

  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', roleCodes: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<StaffMember[]>('/v1/staff')
      .then(setStaff)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  function toggleRole(role: string) {
    setForm((f) => ({ ...f, roleCodes: f.roleCodes.includes(role) ? f.roleCodes.filter((r) => r !== role) : [...f.roleCodes, role] }));
  }

  async function invite() {
    setBusy(true);
    setError(null);
    setInviteLink(null);
    try {
      const res = await apiFetch('/v1/staff/invite', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      const result = (await res.json()) as { setPasswordToken: string };
      setInviteLink(`${window.location.origin}/set-password?token=${result.setPasswordToken}`);
      setForm({ fullName: '', email: '', roleCodes: [] });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not invite this staff member.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading settings" rows={4} />
      </Card>
    );
  }

  return (
    <Card style={{ padding: 'var(--pb-space-4)' }}>
      <p className={styles.hint}>Staff directory</p>

      {canInvite && (
        <Button type="button" variant="secondary" onClick={() => { setShowInvite((v) => !v); setInviteLink(null); }} style={{ margin: 'var(--pb-space-3) 0' }}>
          {showInvite ? 'Cancel' : 'Invite staff member'}
        </Button>
      )}

      {showInvite && (
        <div className={styles.detailPanel} style={{ marginBottom: 'var(--pb-space-3)' }}>
          <div className={styles.formRow}>
            <input aria-label="Full name" className={styles.textInput} placeholder="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            <input aria-label="Email" className={styles.textInput} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <p className={styles.hint} style={{ marginTop: 'var(--pb-space-2)' }}>
            Roles
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pb-space-2)', marginBottom: 'var(--pb-space-3)' }}>
            {ROLE_OPTIONS.map((role) => (
              <label key={role} className={styles.checklistItem} style={{ gap: 4 }}>
                <input type="checkbox" checked={form.roleCodes.includes(role)} onChange={() => toggleRole(role)} />
                {role.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
          <Button type="button" onClick={invite} disabled={busy || !form.fullName || !form.email || form.roleCodes.length === 0}>
            Send invite
          </Button>
          {error && <ErrorState message={error} />}
          {inviteLink && (
            <div style={{ marginTop: 'var(--pb-space-3)' }}>
              <p className={styles.hint}>
                No email provider is wired up in this environment — share this link with the new staff member yourself. It expires in 7 days.
              </p>
              <input aria-label="Invite link" className={styles.textInput} readOnly value={inviteLink} onFocus={(e) => e.currentTarget.select()} style={{ width: '100%' }} />
            </div>
          )}
        </div>
      )}

      {staff.length === 0 ? (
        <EmptyState title="No staff yet" message="Invite one to get started." />
      ) : (
        staff.map((s) => (
          <div key={s.id} className={styles.listRow}>
            <span>
              {s.full_name} <span className={styles.hint}>({s.email})</span>
            </span>
            <span style={{ display: 'flex', gap: 'var(--pb-space-2)', flexWrap: 'wrap' }}>
              {s.role_codes.map((rc) => (
                <Pill key={rc} variant="neutral">
                  {rc.replace(/_/g, ' ')}
                </Pill>
              ))}
            </span>
          </div>
        ))
      )}
    </Card>
  );
}
