/**
 * health.e2e-spec.ts
 *
 * Chapter 28 (Health), FR-OPS-030 — genuinely untested before this file
 * (no existing suite constructs HealthService).
 *
 * Covers:
 *  - upsertRecord()/findRecordByStudent(): a second upsert for the same
 *    student updates the existing row rather than creating a second one
 *    (unique(tenant_id, student_id) + ON CONFLICT DO UPDATE).
 *  - createIncident()/resolveIncident()/reopenIncident(): the
 *    reported <-> resolved state machine — resolve refuses on a
 *    non-'reported' incident, reopen refuses on a non-'resolved' one,
 *    and reopen is a genuine way back (same traced-exit lesson as
 *    discipline's reopenCase()).
 *  - contactGuardian(): rejects a bogus staff/guardian recipientId
 *    before any notification is attempted; a dispatch channel
 *    (whatsapp/sms/email) creates exactly one real notification via
 *    CommunicationService with sensitivityLevel 'confidential'
 *    (FR-COM-050's stricter minimization overriding the requested
 *    channel to email-only, same as discipline's contactGuardian());
 *    a non-dispatch channel (phone_call/in_person) logs the contact
 *    with no notification at all.
 *  - logMedication()/findMedicationLogByStudent(): entries accumulate
 *    and are returned most-recent-first.
 *
 * Harness pattern copied from results-immutability.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom, same per-file
 * fixture tracking and afterAll cleanup.
 *
 * Requires a running Postgres with every migration through
 * 0014_health.sql (and everything seed_demo.sql needs) already applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { HealthService } from '../src/modules/health/health.service';
import { GuardiansService } from '../src/modules/guardians/guardians.service';
import { CommunicationService } from '../src/modules/communication/communication.service';
import { StaffService } from '../src/modules/staff/staff.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise
const TEACHER_SUNRISE = '99999999-0000-0000-0000-000000000003'; // teacher@sunrise, seed_demo.sql's only real seeded teacher

function asUser<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Health (Chapter 28 FR-OPS-030)', () => {
  let pool: Pool;
  const studentIds: string[] = [];
  const recordStudentIds: string[] = [];
  const incidentIds: string[] = [];
  const guardianContactIds: string[] = [];
  const medicationLogIds: string[] = [];
  const guardianIds: string[] = [];
  const notificationIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asUser(async () => {
        await cleanup.query(`delete from health_incident_guardian_contacts where id = any($1::uuid[])`, [guardianContactIds]);
        await cleanup.query(`delete from notification_deliveries where notification_id = any($1::uuid[])`, [notificationIds]);
        await cleanup.query(`delete from notifications where id = any($1::uuid[])`, [notificationIds]);
        await cleanup.query(`delete from medication_administration_log where id = any($1::uuid[])`, [medicationLogIds]);
        await cleanup.query(`delete from health_incidents where id = any($1::uuid[])`, [incidentIds]);
        await cleanup.query(`delete from health_records where student_id = any($1::uuid[])`, [recordStudentIds]);
        await cleanup.query(`delete from student_guardians where student_id = any($1::uuid[])`, [studentIds]);
        await cleanup.query(`delete from guardians where id = any($1::uuid[])`, [guardianIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: HealthService } {
    const conn = new WorkerTenantConnection(pool);
    const guardians = new GuardiansService(conn);
    const communication = new CommunicationService(conn, new StaffService(conn), guardians);
    return { conn, service: new HealthService(conn, communication, new StaffService(conn), guardians) };
  }

  async function createStudent(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asUser(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-OPS-030', 'Fixture', $3, $3) returning id`,
        [SCHOOL_A, uniqueName('ADM'), HEADMASTER],
      ),
    );
    studentIds.push(rows[0].id);
    return rows[0].id;
  }

  describe('upsertRecord()/findRecordByStudent()', () => {
    it('a second upsert for the same student updates the row rather than creating a second one', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        recordStudentIds.push(studentId);

        const first = await asUser(() => service.upsertRecord({ studentId, bloodGroup: 'O+', allergies: 'Penicillin' } as never));
        expect(first.blood_group).toBe('O+');

        const second = await asUser(() => service.upsertRecord({ studentId, bloodGroup: 'A+', allergies: 'None' } as never));
        expect(second.id).toBe(first.id);
        expect(second.blood_group).toBe('A+');
        expect(second.allergies).toBe('None');

        const rows = await asUser(() =>
          conn.query<{ id: string }>(`select id from health_records where student_id = $1`, [studentId]),
        );
        expect(rows).toHaveLength(1);

        const fetched = await asUser(() => service.findRecordByStudent(studentId));
        expect(fetched?.blood_group).toBe('A+');
      } finally {
        conn.release();
      }
    });
  });

  describe('createIncident()/resolveIncident()/reopenIncident()', () => {
    it('walks reported -> resolved -> reported, refusing an out-of-state transition each way', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        const incident = await asUser(() =>
          service.createIncident({ studentId, incidentDate: '2026-08-01', description: 'Fell in the playground', severity: 'minor' } as never),
        );
        incidentIds.push(incident.id);
        expect(incident.status).toBe('reported');

        await expect(asUser(() => service.reopenIncident(incident.id))).rejects.toThrow(/not 'resolved'/);

        const resolved = await asUser(() => service.resolveIncident(incident.id));
        expect(resolved.status).toBe('resolved');
        expect(resolved.resolved_at).not.toBeNull();

        await expect(asUser(() => service.resolveIncident(incident.id))).rejects.toThrow(/not 'reported'/);

        const reopened = await asUser(() => service.reopenIncident(incident.id));
        expect(reopened.status).toBe('reported');
        expect(reopened.reopened_at).not.toBeNull();
      } finally {
        conn.release();
      }
    });
  });

  describe('contactGuardian()', () => {
    it('rejects a bogus staff/guardian recipientId before attempting any notification', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        const incident = await asUser(() =>
          service.createIncident({ studentId, incidentDate: '2026-08-02', description: 'Fever', severity: 'moderate' } as never),
        );
        incidentIds.push(incident.id);

        await expect(
          asUser(() =>
            service.contactGuardian(incident.id, {
              recipientType: 'staff',
              recipientId: '00000000-0000-0000-0000-000000000000',
              recipientName: 'Nobody',
              notes: 'x',
              contactedBy: HEADMASTER,
            } as never),
          ),
        ).rejects.toThrow(/not a real staff member/);

        await expect(
          asUser(() =>
            service.contactGuardian(incident.id, {
              recipientType: 'guardian',
              recipientId: '00000000-0000-0000-0000-000000000000',
              recipientName: 'Nobody',
              notes: 'x',
              contactedBy: HEADMASTER,
            } as never),
          ),
        ).rejects.toThrow(/not a real guardian/);
      } finally {
        conn.release();
      }
    });

    it('a dispatch channel creates exactly one confidential notification, forced to email regardless of requested channel', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        const incident = await asUser(() =>
          service.createIncident({ studentId, incidentDate: '2026-08-03', description: 'Allergic reaction', severity: 'major' } as never),
        );
        incidentIds.push(incident.id);

        const guardians = new GuardiansService(conn);
        const guardian = await asUser(() => guardians.create({ fullName: 'Fixture Guardian', phone: '+233241111111' }));
        guardianIds.push(guardian.id);
        await asUser(() => guardians.linkToStudent(studentId, { guardianId: guardian.id, isPrimaryContact: true }));

        const contact = await asUser(() =>
          service.contactGuardian(incident.id, {
            recipientType: 'guardian',
            recipientId: guardian.id,
            recipientName: 'Fixture Guardian',
            recipientPhone: '+233241111111',
            channel: 'whatsapp',
            notes: 'Called guardian about the reaction',
            contactedBy: HEADMASTER,
          } as never),
        );
        guardianContactIds.push(contact.id);
        expect(contact.notification_id).not.toBeNull();

        const deliveries = await asUser(() =>
          conn.query<{ channel: string }>(
            `select channel from notification_deliveries where notification_id = $1`,
            [contact.notification_id],
          ),
        );
        notificationIds.push(contact.notification_id as string);
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0].channel).toBe('email');
      } finally {
        conn.release();
      }
    });

    it('a non-dispatch channel (in_person) logs the contact with no notification', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        const incident = await asUser(() =>
          service.createIncident({ studentId, incidentDate: '2026-08-04', description: 'Headache', severity: 'minor' } as never),
        );
        incidentIds.push(incident.id);

        const contact = await asUser(() =>
          service.contactGuardian(incident.id, {
            recipientType: 'staff',
            recipientId: TEACHER_SUNRISE,
            recipientName: 'Teacher Sunrise',
            channel: 'in_person',
            notes: 'Spoke with the class teacher directly',
            contactedBy: HEADMASTER,
          } as never),
        );
        guardianContactIds.push(contact.id);
        expect(contact.notification_id).toBeNull();
      } finally {
        conn.release();
      }
    });
  });

  describe('logMedication()/findMedicationLogByStudent()', () => {
    it('accumulates entries, most recent first', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);

        const first = await asUser(() =>
          service.logMedication({ studentId, medicationName: 'Paracetamol', dosage: '250mg', administeredBy: HEADMASTER } as never),
        );
        medicationLogIds.push(first.id);

        const second = await asUser(() =>
          service.logMedication({ studentId, medicationName: 'ORS', dosage: '1 sachet', administeredBy: HEADMASTER } as never),
        );
        medicationLogIds.push(second.id);

        const log = await asUser(() => service.findMedicationLogByStudent(studentId));
        expect(log).toHaveLength(2);
        expect(log[0].id).toBe(second.id);
        expect(log[1].id).toBe(first.id);
      } finally {
        conn.release();
      }
    });
  });
});
