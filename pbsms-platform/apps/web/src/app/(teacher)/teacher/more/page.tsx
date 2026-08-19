'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { LoadingState } from '@/components/states/LoadingState';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { apiGet, logout } from '@/lib/api-client';

interface StaffMember {
  full_name: string;
  email: string;
  role_codes: string[];
}

/**
 * Spec §6.2's fourth bottom-nav destination. Deliberately minimal for
 * this pass — account identity plus sign-out, the one action every other
 * screen in this shell assumes is reachable from somewhere. Settings,
 * notification preferences, install-app entry point etc. are unscoped
 * future additions, not a gap discovered late.
 */
export default function TeacherMorePage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sub = decodeAccessToken()?.sub;
    if (!sub) {
      setLoading(false);
      return;
    }
    apiGet<StaffMember>(`/v1/staff/${sub}`)
      .then(setStaff)
      .finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading account" rows={2} />
      </Card>
    );
  }

  return (
    <Card style={{ padding: 'var(--pb-space-4)' }}>
      {staff ? (
        <div style={{ marginBottom: 'var(--pb-space-5)' }}>
          <p style={{ fontWeight: 600 }}>{staff.full_name}</p>
          <p style={{ color: 'var(--pb-ink-muted)', fontSize: 'var(--pb-text-small)' }}>{staff.email}</p>
          <p style={{ color: 'var(--pb-ink-muted)', fontSize: 'var(--pb-text-caption)' }}>
            {staff.role_codes.join(', ')}
          </p>
        </div>
      ) : (
        <p style={{ color: 'var(--pb-ink-muted)', marginBottom: 'var(--pb-space-5)' }}>Signed in</p>
      )}
      <Button variant="secondary" onClick={handleLogout}>
        Sign out
      </Button>
    </Card>
  );
}
