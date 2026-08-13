/**
 * communication.service.ts
 *
 * Implements SRS v2.1 Chapter 26 (Communication & Notification Centre,
 * FR-COM-010..060). See 0010_communication.sql's header for the full list
 * of deliberate scope cuts (no real WhatsApp/SMS integration, guardians
 * simplified to a generic recipient pair, no scheduler for FR-COM-040's
 * scheduled reports).
 *
 * dispatchToChannel() is the ONE seam to replace once a real WhatsApp
 * Business API / SMS aggregator / SMTP account exists (Appendix E vendor
 * onboarding) — it currently always throws for every channel, the same
 * "don't let a stub be mistaken for a real control" instinct
 * finance.service.ts's recordPayment() uses for mobile_money/card. Nothing
 * else in send() needs to change: the fallback sequencing, delivery
 * logging, preference/sensitivity gating and notification status all
 * already work against whatever dispatchToChannel() actually does.
 *
 * send()'s channel-order rule is FR-COM-050's "stricter minimization" made
 * concrete: 'confidential' notifications never attempt WhatsApp/SMS at
 * all, only email; urgent notifications get the full WhatsApp -> SMS ->
 * email fallback chain (FR-COM-040); anything else tries WhatsApp only.
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { CreateTemplateDto } from './dto/create-template.dto';
import { PreviewTemplateDto } from './dto/preview-template.dto';
import { SetPreferenceDto } from './dto/set-preference.dto';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { AttachEvidenceDto } from './dto/attach-evidence.dto';
import { EscalateReportDto } from './dto/escalate-report.dto';
import { UpsertSettingsDto } from './dto/upsert-settings.dto';
import { StaffService } from '../staff/staff.service';
import { GuardiansService } from '../guardians/guardians.service';

export interface NotificationTemplate {
  id: string;
  tenant_id: string;
  code: string;
  channel: string;
  language: string;
  subject: string | null;
  body: string;
  variables: string[];
  sensitivity_level: string;
  version: number;
  is_active: boolean;
}

export interface CommunicationPreference {
  id: string;
  tenant_id: string;
  recipient_type: string;
  recipient_id: string;
  channel: string;
  opted_in: boolean;
}

export interface Notification {
  id: string;
  tenant_id: string;
  template_id: string | null;
  recipient_type: string;
  recipient_id: string;
  recipient_name: string;
  recipient_phone: string | null;
  recipient_email: string | null;
  subject: string | null;
  body: string;
  sensitivity_level: string;
  is_urgent: boolean;
  status: string;
}

export interface NotificationDelivery {
  id: string;
  tenant_id: string;
  notification_id: string;
  channel: string;
  attempt_sequence: number;
  status: string;
  provider_reference: string | null;
  error_message: string | null;
  cost_amount: string | null;
}

export interface NotificationReport {
  id: string;
  tenant_id: string;
  notification_id: string | null;
  title: string;
  description: string | null;
  owner_user_id: string;
  assigned_by: string | null;
  deadline: string | null;
  status: string;
  evidence: string | null;
  escalation_level: number;
  escalated_to_user_id: string | null;
}

export interface NotificationReportComment {
  id: string;
  tenant_id: string;
  report_id: string;
  author_user_id: string;
  comment: string;
  created_at: string;
}

export interface TenantCommunicationSettings {
  id: string;
  tenant_id: string;
  monthly_sms_cost_threshold: string;
  alert_threshold_pct: string;
  currency: string;
}

export interface SmsSpendStatus {
  spent: number;
  threshold: number;
  alertThresholdAmount: number;
  alertTriggered: boolean;
  currency: string;
}

/** FR-COM-040: full fallback chain for urgent messages; 'confidential'
 * overrides this entirely (see class header). */
const URGENT_FALLBACK_CHAIN = ['whatsapp', 'sms', 'email'];
const CONFIDENTIAL_CHAIN = ['email'];
const DEFAULT_CHAIN = ['whatsapp'];

@Injectable()
export class CommunicationService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly staff: StaffService,
    private readonly guardians: GuardiansService,
  ) {}

  // ---------------------------------------------------------------------
  // Templates (FR-COM-020)
  // ---------------------------------------------------------------------

  /** Creates version 1 if `code` has no active version yet; otherwise
   * retires the current active version and inserts the next version as
   * the new active one, atomically — same shape as
   * grading.service.ts's activatePolicy() locking the row it supersedes. */
  async createTemplate(input: CreateTemplateDto): Promise<NotificationTemplate> {
    const { userId } = TenantContextStore.current();
    await this.db.query('BEGIN');
    try {
      const existingRows = await this.db.query<NotificationTemplate>(
        `select * from notification_templates where code = $1 and is_active for update`,
        [input.code],
      );

      const nextVersion = existingRows.length === 0 ? 1 : existingRows[0].version + 1;

      if (existingRows.length > 0) {
        await this.db.query(
          `update notification_templates set is_active = false, retired_at = now(), updated_at = now(), updated_by = $1 where id = $2`,
          [userId, existingRows[0].id],
        );
      }

      const rows = await this.db.query<NotificationTemplate>(
        `insert into notification_templates
           (tenant_id, code, channel, language, subject, body, variables, sensitivity_level, version, is_active, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, true, $9, $9)
         returning *`,
        [
          input.code,
          input.channel,
          input.language ?? 'en',
          input.subject ?? null,
          input.body,
          JSON.stringify(input.variables ?? []),
          input.sensitivityLevel ?? 'normal',
          nextVersion,
          userId,
        ],
      );
      await this.db.query('COMMIT');
      return rows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  async findAllTemplates(): Promise<NotificationTemplate[]> {
    return this.db.query<NotificationTemplate>(
      `select * from notification_templates order by code, version desc`,
    );
  }

  async findActiveTemplateByCode(code: string): Promise<NotificationTemplate> {
    const rows = await this.db.query<NotificationTemplate>(
      `select * from notification_templates where code = $1 and is_active`,
      [code],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`No active template with code '${code}'`);
    }
    return rows[0];
  }

  async findTemplate(id: string): Promise<NotificationTemplate> {
    const rows = await this.db.query<NotificationTemplate>(`select * from notification_templates where id = $1`, [
      id,
    ]);
    if (rows.length === 0) {
      throw new NotFoundException(`Template ${id} not found`);
    }
    return rows[0];
  }

  async findTemplateVersions(code: string): Promise<NotificationTemplate[]> {
    return this.db.query<NotificationTemplate>(
      `select * from notification_templates where code = $1 order by version desc`,
      [code],
    );
  }

  /** FR-COM-020: the supplied variable set must exactly match the
   * template's own declared `variables` list — neither missing a
   * required substitution nor carrying an unused one silently through
   * to a real send later. Returns the rendered subject/body so a caller
   * can actually see what would go out. */
  async previewTemplate(id: string, input: PreviewTemplateDto): Promise<{ subject: string | null; body: string }> {
    const template = await this.findTemplate(id);
    const required = new Set(template.variables);
    const supplied = new Set(Object.keys(input.variables));

    const missing = [...required].filter((v) => !supplied.has(v));
    const extra = [...supplied].filter((v) => !required.has(v));
    if (missing.length > 0 || extra.length > 0) {
      throw new ConflictException(
        `Cannot preview template ${id}: ` +
          (missing.length > 0 ? `missing variables [${missing.join(', ')}]. ` : '') +
          (extra.length > 0 ? `unexpected variables [${extra.join(', ')}].` : ''),
      );
    }

    return {
      subject: template.subject === null ? null : this.render(template.subject, input.variables),
      body: this.render(template.body, input.variables),
    };
  }

  private render(text: string, variables: Record<string, string>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_match, name) => variables[name] ?? '');
  }

  // ---------------------------------------------------------------------
  // Communication preferences (FR-COM-050)
  // ---------------------------------------------------------------------

  async setPreference(input: SetPreferenceDto): Promise<CommunicationPreference> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<CommunicationPreference>(
      `insert into communication_preferences (tenant_id, recipient_type, recipient_id, channel, opted_in, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $5)
       on conflict (tenant_id, recipient_type, recipient_id, channel)
       do update set opted_in = $4, updated_at = now(), updated_by = $5
       returning *`,
      [input.recipientType, input.recipientId, input.channel, input.optedIn, userId],
    );
    return rows[0];
  }

  async findPreferences(recipientType: string, recipientId: string): Promise<CommunicationPreference[]> {
    return this.db.query<CommunicationPreference>(
      `select * from communication_preferences where recipient_type = $1 and recipient_id = $2`,
      [recipientType, recipientId],
    );
  }

  private async isOptedIn(recipientType: string, recipientId: string, channel: string): Promise<boolean> {
    const rows = await this.db.query<{ opted_in: boolean }>(
      `select opted_in from communication_preferences where recipient_type = $1 and recipient_id = $2 and channel = $3`,
      [recipientType, recipientId, channel],
    );
    // No explicit preference row = opted in by default (FR-COM-050 restricts
    // sending, it doesn't require an opt-in row to exist before any send).
    return rows.length === 0 ? true : rows[0].opted_in;
  }

  // ---------------------------------------------------------------------
  // Notifications (FR-COM-040)
  // ---------------------------------------------------------------------

  async createNotification(input: CreateNotificationDto): Promise<Notification> {
    const { userId } = TenantContextStore.current();

    // Defense-in-depth, not the only check: discipline/health's
    // contactGuardian() already validate 'staff'/'guardian' before ever
    // reaching here for their own direct-log-only channels (phone_call/
    // in_person never call this method at all) — this catches the direct
    // POST /v1/communication/notifications path and inventory's
    // low-stock alert path, which otherwise have no validation of their
    // own. See 0018_staff_directory.sql's / 0019_guardians.sql's headers
    // for why this can't be a DB-level FK.
    if (input.recipientType === 'staff' && !(await this.staff.isRealStaffMember(input.recipientId))) {
      throw new NotFoundException(`recipientId ${input.recipientId} is not a real staff member of this tenant`);
    }
    if (input.recipientType === 'guardian' && !(await this.guardians.isRealGuardian(input.recipientId))) {
      throw new NotFoundException(`recipientId ${input.recipientId} is not a real guardian of this tenant`);
    }

    let subject = input.subject ?? null;
    let body = input.body;
    let sensitivityLevel = input.sensitivityLevel ?? 'normal';

    if (input.templateId) {
      const rendered = await this.previewTemplate(input.templateId, { variables: input.variables ?? {} });
      subject = rendered.subject;
      body = rendered.body;
      if (!input.sensitivityLevel) {
        const template = await this.findTemplate(input.templateId);
        sensitivityLevel = template.sensitivity_level;
      }
    }

    if (!body) {
      throw new ConflictException('createNotification requires either templateId+variables or an explicit body');
    }

    const rows = await this.db.query<Notification>(
      `insert into notifications
         (tenant_id, template_id, recipient_type, recipient_id, recipient_name, recipient_phone, recipient_email,
          subject, body, sensitivity_level, is_urgent, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       returning *`,
      [
        input.templateId ?? null,
        input.recipientType,
        input.recipientId,
        input.recipientName,
        input.recipientPhone ?? null,
        input.recipientEmail ?? null,
        subject,
        body,
        sensitivityLevel,
        input.isUrgent ?? false,
        userId,
      ],
    );
    return rows[0];
  }

  async findAllNotifications(): Promise<Notification[]> {
    return this.db.query<Notification>(`select * from notifications order by created_at desc`);
  }

  async findNotification(id: string): Promise<Notification> {
    const rows = await this.db.query<Notification>(`select * from notifications where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
    return rows[0];
  }

  async findDeliveries(notificationId: string): Promise<NotificationDelivery[]> {
    return this.db.query<NotificationDelivery>(
      `select * from notification_deliveries where notification_id = $1 order by attempt_sequence`,
      [notificationId],
    );
  }

  /** Real WhatsApp/SMS/email dispatch — the one seam to replace once a
   * real provider account exists (see class header). Always rejects
   * today. */
  private async dispatchToChannel(channel: string): Promise<{ providerReference: string }> {
    throw new Error(
      `Channel '${channel}' requires a real provider integration (FR-COM-010/030, Chapter 26.1) that is not ` +
        `implemented in this scaffold — build the WhatsApp Business API / SMS aggregator / SMTP adapter before enabling this path.`,
    );
  }

  /** The FR-COM-040 fallback engine. Locks the notification row, tries
   * each channel in the order send() resolves (confidential -> email
   * only; urgent -> WhatsApp -> SMS -> email; else -> WhatsApp only),
   * skipping a channel outright (status = 'blocked_by_preference') if the
   * recipient opted out of it, and logging every attempt — successful or
   * not — as its own notification_deliveries row. All writes for one
   * send() call happen in a single transaction, the same "multi-statement
   * write that must land as one unit" reasoning as generateInvoice(). */
  async send(notificationId: string): Promise<Notification> {
    const { userId } = TenantContextStore.current();
    await this.db.query('BEGIN');
    try {
      const notificationRows = await this.db.query<Notification>(
        `select * from notifications where id = $1 for update`,
        [notificationId],
      );
      if (notificationRows.length === 0) {
        throw new NotFoundException(`Notification ${notificationId} not found`);
      }
      const notification = notificationRows[0];
      if (!['queued', 'exhausted'].includes(notification.status)) {
        throw new ConflictException(
          `Cannot send notification ${notificationId}: it is '${notification.status}', not 'queued'/'exhausted'`,
        );
      }

      const chain =
        notification.sensitivity_level === 'confidential'
          ? CONFIDENTIAL_CHAIN
          : notification.is_urgent
            ? URGENT_FALLBACK_CHAIN
            : DEFAULT_CHAIN;

      let delivered = false;
      let sequence = 1;
      for (const channel of chain) {
        const optedIn = await this.isOptedIn(notification.recipient_type, notification.recipient_id, channel);
        if (!optedIn) {
          await this.db.query(
            `insert into notification_deliveries (tenant_id, notification_id, channel, attempt_sequence, status)
             values (current_tenant_id(), $1, $2, $3, 'blocked_by_preference')
             on conflict (tenant_id, notification_id, channel) do nothing`,
            [notificationId, channel, sequence],
          );
          sequence += 1;
          continue;
        }

        try {
          const result = await this.dispatchToChannel(channel);
          await this.db.query(
            `insert into notification_deliveries
               (tenant_id, notification_id, channel, attempt_sequence, status, provider_reference, delivered_at)
             values (current_tenant_id(), $1, $2, $3, 'sent', $4, now())
             on conflict (tenant_id, notification_id, channel) do nothing`,
            [notificationId, channel, sequence, result.providerReference],
          );
          delivered = true;
          sequence += 1;
          break;
        } catch (err) {
          await this.db.query(
            `insert into notification_deliveries (tenant_id, notification_id, channel, attempt_sequence, status, error_message)
             values (current_tenant_id(), $1, $2, $3, 'rejected_not_implemented', $4)
             on conflict (tenant_id, notification_id, channel) do nothing`,
            [notificationId, channel, sequence, (err as Error).message],
          );
          sequence += 1;
        }
      }

      const newStatus = delivered ? 'delivered' : 'exhausted';
      const updatedRows = await this.db.query<Notification>(
        `update notifications set status = $1, updated_at = now(), updated_by = $2 where id = $3 returning *`,
        [newStatus, userId, notificationId],
      );
      await this.db.query('COMMIT');
      return updatedRows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Tenant communication settings (FR-COM-030)
  // ---------------------------------------------------------------------

  async upsertSettings(input: UpsertSettingsDto): Promise<TenantCommunicationSettings> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<TenantCommunicationSettings>(
      `insert into tenant_communication_settings (tenant_id, monthly_sms_cost_threshold, alert_threshold_pct, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $3)
       on conflict (tenant_id)
       do update set monthly_sms_cost_threshold = $1, alert_threshold_pct = $2, updated_at = now(), updated_by = $3
       returning *`,
      [input.monthlySmsCostThreshold, input.alertThresholdPct ?? 80, userId],
    );
    return rows[0];
  }

  async findSettings(): Promise<TenantCommunicationSettings | null> {
    const rows = await this.db.query<TenantCommunicationSettings>(
      `select * from tenant_communication_settings limit 1`,
    );
    return rows.length === 0 ? null : rows[0];
  }

  /** Sums notification_deliveries.cost_amount for channel = 'sms' in the
   * current calendar month. Always 0 today since no SMS ever actually
   * sends (see class header) — real numbers appear once a real aggregator
   * webhook populates cost_amount. */
  async smsSpendThisMonth(): Promise<SmsSpendStatus> {
    const settings = await this.findSettings();
    if (!settings) {
      throw new NotFoundException(`No communication settings configured for this tenant yet`);
    }
    const rows = await this.db.query<{ total: string | null }>(
      `select sum(cost_amount) as total from notification_deliveries
       where channel = 'sms' and attempted_at >= date_trunc('month', now())`,
    );
    const spent = Number(rows[0].total ?? 0);
    const threshold = Number(settings.monthly_sms_cost_threshold);
    const alertThresholdAmount = Math.round(threshold * (Number(settings.alert_threshold_pct) / 100) * 100) / 100;
    return {
      spent,
      threshold,
      alertThresholdAmount,
      alertTriggered: spent >= alertThresholdAmount,
      currency: settings.currency,
    };
  }

  // ---------------------------------------------------------------------
  // Acknowledgeable reports (FR-COM-060)
  // ---------------------------------------------------------------------

  async createReport(input: CreateReportDto): Promise<NotificationReport> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<NotificationReport>(
      `insert into notification_reports
         (tenant_id, notification_id, title, description, owner_user_id, assigned_by, deadline, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $7)
       returning *`,
      [
        input.notificationId ?? null,
        input.title,
        input.description ?? null,
        input.ownerUserId,
        input.assignedBy ?? null,
        input.deadline ?? null,
        userId,
      ],
    );
    return rows[0];
  }

  async findAllReports(): Promise<NotificationReport[]> {
    return this.db.query<NotificationReport>(`select * from notification_reports order by created_at desc`);
  }

  async findReport(id: string): Promise<NotificationReport> {
    const rows = await this.db.query<NotificationReport>(`select * from notification_reports where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Report ${id} not found`);
    }
    return rows[0];
  }

  /** Overdue = has a deadline in the past and isn't already completed —
   * the query a real scheduler (FR-COM-040, not built here) would poll. */
  async findOverdueReports(): Promise<NotificationReport[]> {
    return this.db.query<NotificationReport>(
      `select * from notification_reports
       where status != 'completed' and deadline is not null and deadline < now()
       order by deadline`,
    );
  }

  async acknowledgeReport(id: string): Promise<NotificationReport> {
    const { userId } = TenantContextStore.current();
    const report = await this.findReport(id);
    if (report.status !== 'open') {
      throw new ConflictException(`Cannot acknowledge report ${id}: it is '${report.status}', not 'open'`);
    }
    const rows = await this.db.query<NotificationReport>(
      `update notification_reports set status = 'acknowledged', acknowledged_at = now(), updated_at = now(), updated_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  /** Accepts 'acknowledged' OR 'reopened' as the predecessor — a reopened
   * report needs an explicit way back into active work, not just a label,
   * the same lesson results.service.ts's reopen()/returnForCorrection()
   * gap taught (see memory: every state needs a traced exit, not just the
   * happy-path chain). */
  async startReport(id: string): Promise<NotificationReport> {
    const { userId } = TenantContextStore.current();
    const report = await this.findReport(id);
    if (!['acknowledged', 'reopened'].includes(report.status)) {
      throw new ConflictException(
        `Cannot start report ${id}: it is '${report.status}', not 'acknowledged'/'reopened'`,
      );
    }
    const rows = await this.db.query<NotificationReport>(
      `update notification_reports set status = 'in_progress', updated_at = now(), updated_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  async attachEvidence(id: string, input: AttachEvidenceDto): Promise<NotificationReport> {
    const { userId } = TenantContextStore.current();
    const report = await this.findReport(id);
    if (report.status === 'completed') {
      throw new ConflictException(`Cannot attach evidence to report ${id}: it is already 'completed'`);
    }
    const rows = await this.db.query<NotificationReport>(
      `update notification_reports set evidence = $1, updated_at = now(), updated_by = $2 where id = $3 returning *`,
      [input.evidence, userId, id],
    );
    return rows[0];
  }

  async completeReport(id: string): Promise<NotificationReport> {
    const { userId } = TenantContextStore.current();
    const report = await this.findReport(id);
    if (!['acknowledged', 'in_progress'].includes(report.status)) {
      throw new ConflictException(
        `Cannot complete report ${id}: it is '${report.status}', not 'acknowledged'/'in_progress'`,
      );
    }
    const rows = await this.db.query<NotificationReport>(
      `update notification_reports set status = 'completed', completed_at = now(), updated_at = now(), updated_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  async reopenReport(id: string): Promise<NotificationReport> {
    const { userId } = TenantContextStore.current();
    const report = await this.findReport(id);
    if (report.status !== 'completed') {
      throw new ConflictException(`Cannot reopen report ${id}: it is '${report.status}', not 'completed'`);
    }
    const rows = await this.db.query<NotificationReport>(
      `update notification_reports set status = 'reopened', reopened_at = now(), updated_at = now(), updated_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }

  /** FR-COM-060: overdue escalation. No org-chart config exists, so the
   * caller names the escalation target directly (see EscalateReportDto). */
  async escalateReport(id: string, input: EscalateReportDto): Promise<NotificationReport> {
    const { userId } = TenantContextStore.current();
    const report = await this.findReport(id);
    if (report.status === 'completed') {
      throw new ConflictException(`Cannot escalate report ${id}: it is already 'completed'`);
    }
    const rows = await this.db.query<NotificationReport>(
      `update notification_reports
       set escalation_level = escalation_level + 1, escalated_to_user_id = $1, updated_at = now(), updated_by = $2
       where id = $3
       returning *`,
      [input.escalatedToUserId, userId, id],
    );
    return rows[0];
  }

  async addComment(reportId: string, input: AddCommentDto): Promise<NotificationReportComment> {
    await this.findReport(reportId);
    const rows = await this.db.query<NotificationReportComment>(
      `insert into notification_report_comments (tenant_id, report_id, author_user_id, comment)
       values (current_tenant_id(), $1, $2, $3)
       returning *`,
      [reportId, input.authorUserId, input.comment],
    );
    return rows[0];
  }

  async findComments(reportId: string): Promise<NotificationReportComment[]> {
    return this.db.query<NotificationReportComment>(
      `select * from notification_report_comments where report_id = $1 order by created_at`,
      [reportId],
    );
  }
}
