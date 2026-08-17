/**
 * mass-notification.handler.ts — FR-JOB-020's other named example. Reuses
 * CommunicationService.createNotification()+.send() per recipient
 * unchanged, so the existing fallback-channel/sensitivity/preference-
 * gating rules apply exactly as they do for a single ad-hoc notification.
 *
 * Scope simplification, documented not hidden: the payload carries full
 * recipient details (type/id/name/phone/email) rather than just ids —
 * building a generic "resolve N ids of type X to display info" bulk
 * lookup across staff/guardian/student is a separate feature (StaffService/
 * GuardiansService only expose per-id lookups today). The caller (a
 * schedule creator, or a future endpoint that already has the recipient
 * list on hand — e.g. "all guardians of this class") is responsible for
 * assembling that list; this handler's job is fan-out + delivery only.
 *
 * Same per-item-outcome batch shape as report-card-batch.handler.ts: one
 * bad recipient must not block the rest.
 */

import { CommunicationService } from '../../modules/communication/communication.service';
import { StaffService } from '../../modules/staff/staff.service';
import { GuardiansService } from '../../modules/guardians/guardians.service';
import { WorkerTenantConnection } from '../../common/database/worker-tenant-connection';

export interface MassNotificationRecipient {
  recipientType: 'guardian' | 'staff' | 'student';
  recipientId: string;
  recipientName: string;
  recipientPhone?: string;
  recipientEmail?: string;
}

export interface MassNotificationPayload {
  templateId?: string;
  variables?: Record<string, string>;
  subject?: string;
  body?: string;
  sensitivityLevel?: string;
  isUrgent?: boolean;
  recipients: MassNotificationRecipient[];
}

export async function handleMassNotification(payload: MassNotificationPayload, db: WorkerTenantConnection): Promise<void> {
  if (!payload.recipients || payload.recipients.length === 0) {
    throw new Error('mass_notification job payload has no recipients');
  }

  const staff = new StaffService(db);
  const guardians = new GuardiansService(db);
  const communication = new CommunicationService(db, staff, guardians);

  const failures: string[] = [];

  for (const recipient of payload.recipients) {
    try {
      const notification = await communication.createNotification({
        templateId: payload.templateId,
        variables: payload.variables,
        subject: payload.subject,
        body: payload.body,
        sensitivityLevel: payload.sensitivityLevel,
        isUrgent: payload.isUrgent,
        recipientType: recipient.recipientType,
        recipientId: recipient.recipientId,
        recipientName: recipient.recipientName,
        recipientPhone: recipient.recipientPhone,
        recipientEmail: recipient.recipientEmail,
      });
      await communication.send(notification.id);
    } catch (err) {
      failures.push(`${recipient.recipientId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length}/${payload.recipients.length} notifications failed: ${failures.join('; ')}`);
  }
}
