/**
 * dunning-notification.handler.ts — closes FR-BIL-040's previously-deferred
 * half. billing.service.ts's runDunningStep() runs off PLATFORM_POOL (no
 * tenant context, TEN-005) and does the REAL status transition, then calls
 * platform_enqueue_job() to enqueue exactly this job type for the specific
 * tenant being dunned — see 0027_background_jobs.sql's header for why that
 * needed a SECURITY DEFINER bypass rather than a plain grant. This handler
 * is what finally sends the "notified by email and WhatsApp" half A4 left
 * undone, safely: it runs in the worker process, which builds its own
 * WorkerTenantConnection rather than touching Nest's Scope.REQUEST DI at
 * all — the exact trap that caused Authorization Pass 1's real bug #1.
 *
 * Recipient choice: Chapter 5 doesn't name a specific "billing contact"
 * entity (tenants.billing_email is a plain string, not a real staff/
 * guardian record CommunicationService's recipient validation can check),
 * so this notifies every LEADERSHIP-tier staff member (proprietor/
 * administrator/headmaster) — a documented modeling decision, same
 * category as Chapter 4.1's transition graph or 13.3's scope hierarchy
 * needing a judgment call the SRS text doesn't spell out. sensitivityLevel
 * 'restricted' (billing status, not for casual disclosure); isUrgent only
 * once the tenant is actually suspended, not on the earlier past_due step.
 */

import { CommunicationService } from '../../modules/communication/communication.service';
import { StaffService } from '../../modules/staff/staff.service';
import { GuardiansService } from '../../modules/guardians/guardians.service';
import { WorkerTenantConnection } from '../../common/database/worker-tenant-connection';
import { LEADERSHIP } from '../../common/auth/role-groups';

export interface DunningNotificationPayload {
  tenantStatus: string;
  reason: string;
}

export async function handleDunningNotification(payload: DunningNotificationPayload, db: WorkerTenantConnection): Promise<void> {
  const staffService = new StaffService(db);
  const guardiansService = new GuardiansService(db);
  const communication = new CommunicationService(db, staffService, guardiansService);

  const allStaff = await staffService.findAll();
  const leadership = allStaff.filter((s) => s.role_codes.some((r) => LEADERSHIP.includes(r)));

  if (leadership.length === 0) {
    throw new Error('No LEADERSHIP-tier staff found to notify for dunning step');
  }

  const subject = `Billing status: ${payload.tenantStatus}`;
  const body = `Your school's account billing status changed to '${payload.tenantStatus}'. Reason: ${payload.reason}. Please settle the outstanding platform invoice to restore full access.`;

  const failures: string[] = [];
  for (const member of leadership) {
    try {
      const notification = await communication.createNotification({
        subject,
        body,
        recipientType: 'staff',
        recipientId: member.id,
        recipientName: member.full_name,
        recipientEmail: member.email,
        sensitivityLevel: 'restricted',
        isUrgent: payload.tenantStatus === 'suspended',
      });
      await communication.send(notification.id);
    } catch (err) {
      failures.push(`${member.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length}/${leadership.length} dunning notifications failed: ${failures.join('; ')}`);
  }
}
