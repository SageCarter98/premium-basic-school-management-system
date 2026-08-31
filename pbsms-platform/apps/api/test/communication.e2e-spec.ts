/**
 * communication.e2e-spec.ts
 *
 * Chapter 26 (Communication & Notification Centre), FR-COM-020/040/050/060
 * — genuinely untested before this file (no existing suite constructs
 * CommunicationService). FR-COM-010 (real WhatsApp Business API) and
 * FR-COM-030 (real SMS aggregator) are NOT built — dispatchToChannel()
 * always throws today, a deliberate scope cut the class's own header
 * comment names explicitly (same pattern as finance's unimplemented
 * payment methods). This suite exercises that honestly: send() tests
 * assert on the 'rejected_not_implemented'/'exhausted' outcome a stub
 * dispatch actually produces, not a successful delivery that doesn't
 * exist yet.
 *
 * Covers:
 *  - FR-COM-020: createTemplate()'s version-then-retire-the-old-one
 *    lifecycle, and previewTemplate()'s exact-match variable validation
 *    (missing/extra rejected, correct substitution rendered).
 *  - FR-COM-040/050: send()'s channel-chain resolution (confidential ->
 *    email only; urgent -> whatsapp -> sms -> email fallback; default ->
 *    whatsapp only) logged as one notification_deliveries row per
 *    attempt, and preference-based skipping (an opted-out channel is
 *    logged 'blocked_by_preference', never attempted).
 *  - FR-COM-060: the report lifecycle (open -> acknowledged ->
 *    in_progress -> completed -> reopened), escalation incrementing
 *    escalation_level, and comments.
 *
 * Harness pattern copied from results-immutability.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom, same per-file
 * fixture tracking and afterAll cleanup. `recipientType: 'student'` is
 * used throughout for notification fixtures specifically because
 * createNotification() only FK-validates 'staff'/'guardian' recipients
 * (see its own comment) — 'student' needs no real-record lookup, keeping
 * fixtures to just an id.
 *
 * Requires a running Postgres with every migration through
 * 0010_communication.sql (and everything seed_demo.sql needs) already
 * applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { CommunicationService } from '../src/modules/communication/communication.service';
import { StaffService } from '../src/modules/staff/staff.service';
import { GuardiansService } from '../src/modules/guardians/guardians.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

function asUser<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueCode(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Communication (Chapter 26 FR-COM-020/040/050/060)', () => {
  let pool: Pool;
  const templateCodes: string[] = [];
  const notificationIds: string[] = [];
  const reportIds: string[] = [];
  const preferenceIds: string[] = [];
  const studentIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asUser(async () => {
        await cleanup.query(`delete from notification_report_comments where report_id = any($1::uuid[])`, [reportIds]);
        await cleanup.query(`delete from notification_reports where id = any($1::uuid[])`, [reportIds]);
        await cleanup.query(`delete from notification_deliveries where notification_id = any($1::uuid[])`, [notificationIds]);
        await cleanup.query(`delete from notifications where id = any($1::uuid[])`, [notificationIds]);
        await cleanup.query(`delete from communication_preferences where id = any($1::uuid[])`, [preferenceIds]);
        await cleanup.query(`delete from notification_templates where code = any($1::text[])`, [templateCodes]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  async function createStudent(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asUser(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-COM', 'Fixture', $3, $3) returning id`,
        [SCHOOL_A, uniqueCode('ADM'), HEADMASTER],
      ),
    );
    studentIds.push(rows[0].id);
    return rows[0].id;
  }

  function harness(): { conn: WorkerTenantConnection; service: CommunicationService } {
    const conn = new WorkerTenantConnection(pool);
    return {
      conn,
      service: new CommunicationService(conn, new StaffService(conn), new GuardiansService(conn)),
    };
  }

  /** recipientId must be a freshly-created student (never the seeded
   * STUDENT_A) — seed_demo.sql deliberately opts that student out of SMS,
   * which would silently contaminate the channel-chain assertions below. */
  async function sendNotification(
    service: CommunicationService,
    recipientId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const notification = await asUser(() =>
      service.createNotification({
        recipientType: 'student',
        recipientId,
        recipientName: 'Fixture Student',
        body: 'Fixture notification body',
        ...overrides,
      } as never),
    );
    notificationIds.push(notification.id);
    return asUser(() => service.send(notification.id));
  }

  describe('createTemplate()/previewTemplate() — FR-COM-020', () => {
    it('versions a template: creating again with the same code retires the old version and activates the next', async () => {
      const { conn, service } = harness();
      try {
        const code = uniqueCode('FR-COM-020');
        templateCodes.push(code);
        const v1 = await asUser(() =>
          service.createTemplate({ code, channel: 'email', body: 'Hello {{name}}', variables: ['name'] } as never),
        );
        expect(v1.version).toBe(1);
        expect(v1.is_active).toBe(true);

        const v2 = await asUser(() =>
          service.createTemplate({ code, channel: 'email', body: 'Hi {{name}}!', variables: ['name'] } as never),
        );
        expect(v2.version).toBe(2);
        expect(v2.is_active).toBe(true);

        const v1AfterRetire = await asUser(() => service.findTemplate(v1.id));
        expect(v1AfterRetire.is_active).toBe(false);

        const active = await asUser(() => service.findActiveTemplateByCode(code));
        expect(active.id).toBe(v2.id);
      } finally {
        conn.release();
      }
    });

    it('rejects a preview with missing or extra variables, renders correctly when they match exactly', async () => {
      const { conn, service } = harness();
      try {
        const code = uniqueCode('FR-COM-020-preview');
        templateCodes.push(code);
        const template = await asUser(() =>
          service.createTemplate({
            code,
            channel: 'sms',
            subject: 'Re: {{topic}}',
            body: 'Dear {{name}}, regarding {{topic}}.',
            variables: ['name', 'topic'],
          } as never),
        );

        await expect(
          asUser(() => service.previewTemplate(template.id, { variables: { name: 'Ama' } } as never)),
        ).rejects.toThrow(/missing variables \[topic\]/);

        await expect(
          asUser(() =>
            service.previewTemplate(template.id, { variables: { name: 'Ama', topic: 'fees', extra: 'x' } } as never),
          ),
        ).rejects.toThrow(/unexpected variables \[extra\]/);

        const rendered = await asUser(() =>
          service.previewTemplate(template.id, { variables: { name: 'Ama', topic: 'fees' } } as never),
        );
        expect(rendered.subject).toBe('Re: fees');
        expect(rendered.body).toBe('Dear Ama, regarding fees.');
      } finally {
        conn.release();
      }
    });
  });

  describe('send() — FR-COM-040/050 channel-chain resolution and preference gating', () => {
    it('confidential notifications only ever attempt email, ending "exhausted" since no real provider exists', async () => {
      const { conn, service } = harness();
      try {
        const sent = await sendNotification(service, await createStudent(conn), { sensitivityLevel: 'confidential' });
        expect(sent.status).toBe('exhausted');

        const deliveries = await asUser(() => service.findDeliveries(sent.id));
        expect(deliveries.map((d) => d.channel)).toEqual(['email']);
        expect(deliveries[0].status).toBe('rejected_not_implemented');
      } finally {
        conn.release();
      }
    });

    it('urgent notifications attempt the full whatsapp -> sms -> email fallback chain in order', async () => {
      const { conn, service } = harness();
      try {
        const sent = await sendNotification(service, await createStudent(conn), { isUrgent: true });
        expect(sent.status).toBe('exhausted');

        const deliveries = await asUser(() => service.findDeliveries(sent.id));
        expect(deliveries.map((d) => d.channel)).toEqual(['whatsapp', 'sms', 'email']);
        expect(deliveries.map((d) => d.attempt_sequence)).toEqual([1, 2, 3]);
        expect(deliveries.every((d) => d.status === 'rejected_not_implemented')).toBe(true);
      } finally {
        conn.release();
      }
    });

    it('a non-urgent, non-confidential notification only ever attempts whatsapp', async () => {
      const { conn, service } = harness();
      try {
        const sent = await sendNotification(service, await createStudent(conn));
        const deliveries = await asUser(() => service.findDeliveries(sent.id));
        expect(deliveries.map((d) => d.channel)).toEqual(['whatsapp']);
      } finally {
        conn.release();
      }
    });

    it('skips a channel the recipient opted out of, logging blocked_by_preference rather than attempting it', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        const preference = await asUser(() =>
          service.setPreference({
            recipientType: 'student',
            recipientId: studentId,
            channel: 'whatsapp',
            optedIn: false,
          } as never),
        );
        preferenceIds.push(preference.id);

        const sent = await sendNotification(service, studentId, { isUrgent: true });
        const deliveries = await asUser(() => service.findDeliveries(sent.id));
        expect(deliveries.map((d) => ({ channel: d.channel, status: d.status }))).toEqual([
          { channel: 'whatsapp', status: 'blocked_by_preference' },
          { channel: 'sms', status: 'rejected_not_implemented' },
          { channel: 'email', status: 'rejected_not_implemented' },
        ]);
      } finally {
        conn.release();
      }
    });
  });

  describe('report lifecycle — FR-COM-060', () => {
    it('walks open -> acknowledged -> in_progress -> completed -> reopened, and rejects out-of-order transitions', async () => {
      const { conn, service } = harness();
      try {
        const report = await asUser(() =>
          service.createReport({ title: 'Follow up on low attendance', ownerUserId: HEADMASTER } as never),
        );
        reportIds.push(report.id);
        expect(report.status).toBe('open');

        await expect(asUser(() => service.startReport(report.id))).rejects.toThrow(/not 'acknowledged'\/'reopened'/);

        const acknowledged = await asUser(() => service.acknowledgeReport(report.id));
        expect(acknowledged.status).toBe('acknowledged');

        const started = await asUser(() => service.startReport(report.id));
        expect(started.status).toBe('in_progress');

        const completed = await asUser(() => service.completeReport(report.id));
        expect(completed.status).toBe('completed');

        await expect(asUser(() => service.attachEvidence(report.id, { evidence: 'too late' } as never))).rejects.toThrow(
          /already 'completed'/,
        );

        const reopened = await asUser(() => service.reopenReport(report.id));
        expect(reopened.status).toBe('reopened');

        // reopened -> in_progress is legal again, closing the loop.
        const startedAgain = await asUser(() => service.startReport(report.id));
        expect(startedAgain.status).toBe('in_progress');
      } finally {
        conn.release();
      }
    });

    it('escalation increments escalation_level and records the target; comments attach independently of status', async () => {
      const { conn, service } = harness();
      try {
        const report = await asUser(() =>
          service.createReport({ title: 'Repeated absence follow-up', ownerUserId: HEADMASTER } as never),
        );
        reportIds.push(report.id);

        const escalatedOnce = await asUser(() =>
          service.escalateReport(report.id, { escalatedToUserId: HEADMASTER } as never),
        );
        expect(escalatedOnce.escalation_level).toBe(1);
        const escalatedTwice = await asUser(() =>
          service.escalateReport(report.id, { escalatedToUserId: HEADMASTER } as never),
        );
        expect(escalatedTwice.escalation_level).toBe(2);
        expect(escalatedTwice.escalated_to_user_id).toBe(HEADMASTER);

        const comment = await asUser(() =>
          service.addComment(report.id, { authorUserId: HEADMASTER, comment: 'Called the guardian, no answer.' } as never),
        );
        expect(comment.comment).toBe('Called the guardian, no answer.');

        const comments = await asUser(() => service.findComments(report.id));
        expect(comments.map((c) => c.id)).toContain(comment.id);
      } finally {
        conn.release();
      }
    });
  });
});
