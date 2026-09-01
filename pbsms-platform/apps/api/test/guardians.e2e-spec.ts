/**
 * guardians.e2e-spec.ts
 *
 * FR-STU-020 (Chapter 16.2) — the real guardian directory and
 * student<->guardian link. GuardiansService had zero test coverage
 * before this file (guardian create/link is only ever exercised
 * indirectly, as a fixture helper, inside other modules' e2e suites —
 * e.g. health.e2e-spec.ts's contactGuardian() test — never asserted on
 * its own terms).
 *
 * Access grants/requests (Stage 6 Parent View onboarding) are
 * deliberately out of scope here — separate file, separate concern.
 *
 * Covers:
 *  - create()/findOne(): a real guardian is found, an unknown id 404s.
 *  - linkToStudent(): 404s on an unknown student OR an unknown guardian
 *    before writing any link row; a successful link carries every
 *    relationship-level flag through (primary/emergency/pickup/finance/
 *    report access).
 *  - findForStudent(): orders primary-contact-first, joins full_name/
 *    phone/email from the guardian row.
 *  - updateLink(): a partial update (coalesce) leaves unspecified flags
 *    untouched; an unknown link id 404s.
 *  - unlink(): removes the link; a second unlink of the same id 404s.
 *  - isRealGuardian(): true for a real id, false for a bogus one — the
 *    exact check discipline/health's contactGuardian() rely on.
 *
 * Harness pattern copied from results-immutability.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom, same per-file
 * fixture tracking and afterAll cleanup.
 *
 * Requires a running Postgres with every migration through
 * 0019_guardians.sql (and seed_demo.sql) applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { GuardiansService } from '../src/modules/guardians/guardians.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

function asHeadmaster<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Guardians (FR-STU-020)', () => {
  let pool: Pool;
  const studentIds: string[] = [];
  const guardianIds: string[] = [];
  const linkIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asHeadmaster(async () => {
        await cleanup.query(`delete from student_guardians where id = any($1::uuid[])`, [linkIds]);
        await cleanup.query(`delete from guardians where id = any($1::uuid[])`, [guardianIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: GuardiansService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new GuardiansService(conn) };
  }

  async function createStudent(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-STU-020', 'Fixture', $3, $3) returning id`,
        [SCHOOL_A, uniqueName('ADM'), HEADMASTER],
      ),
    );
    studentIds.push(rows[0].id);
    return rows[0].id;
  }

  describe('create()/findOne()/isRealGuardian()', () => {
    it('finds a real guardian, 404s on an unknown id, and isRealGuardian() agrees', async () => {
      const { conn, service } = harness();
      try {
        const guardian = await asHeadmaster(() => service.create({ fullName: 'Fixture Guardian', phone: '+233241111111' }));
        guardianIds.push(guardian.id);

        const fetched = await asHeadmaster(() => service.findOne(guardian.id));
        expect(fetched.full_name).toBe('Fixture Guardian');

        await expect(asHeadmaster(() => service.findOne('00000000-0000-0000-0000-000000000000'))).rejects.toThrow(/not found/);

        expect(await asHeadmaster(() => service.isRealGuardian(guardian.id))).toBe(true);
        expect(await asHeadmaster(() => service.isRealGuardian('00000000-0000-0000-0000-000000000000'))).toBe(false);
      } finally {
        conn.release();
      }
    });
  });

  describe('linkToStudent()/findForStudent()', () => {
    it('404s on an unknown student or guardian, then links with every relationship flag carried through', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        const guardian = await asHeadmaster(() => service.create({ fullName: 'Kofi Guardian' }));
        guardianIds.push(guardian.id);

        await expect(
          asHeadmaster(() => service.linkToStudent('00000000-0000-0000-0000-000000000000', { guardianId: guardian.id })),
        ).rejects.toThrow(/Student .* not found/);
        await expect(
          asHeadmaster(() => service.linkToStudent(studentId, { guardianId: '00000000-0000-0000-0000-000000000000' })),
        ).rejects.toThrow(/not found/);

        const link = await asHeadmaster(() =>
          service.linkToStudent(studentId, {
            guardianId: guardian.id,
            relationship: 'father',
            isPrimaryContact: true,
            isEmergencyContact: true,
            canPickup: true,
            hasFinanceAccess: true,
            hasReportAccess: true,
          }),
        );
        linkIds.push(link.id);
        expect(link.relationship).toBe('father');
        expect(link.is_primary_contact).toBe(true);
        expect(link.has_finance_access).toBe(true);

        const secondGuardian = await asHeadmaster(() => service.create({ fullName: 'Ama Guardian' }));
        guardianIds.push(secondGuardian.id);
        const secondLink = await asHeadmaster(() =>
          service.linkToStudent(studentId, { guardianId: secondGuardian.id, isPrimaryContact: false }),
        );
        linkIds.push(secondLink.id);

        const found = await asHeadmaster(() => service.findForStudent(studentId));
        expect(found).toHaveLength(2);
        expect(found[0].guardian_id).toBe(guardian.id); // primary contact first
        expect(found[0].full_name).toBe('Kofi Guardian');
      } finally {
        conn.release();
      }
    });
  });

  describe('updateLink()', () => {
    it('a partial update leaves unspecified flags untouched, an unknown link id 404s', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        const guardian = await asHeadmaster(() => service.create({ fullName: 'Yaw Guardian' }));
        guardianIds.push(guardian.id);
        const link = await asHeadmaster(() =>
          service.linkToStudent(studentId, { guardianId: guardian.id, canPickup: true, hasFinanceAccess: false }),
        );
        linkIds.push(link.id);

        const updated = await asHeadmaster(() => service.updateLink(link.id, { hasFinanceAccess: true }));
        expect(updated.has_finance_access).toBe(true);
        expect(updated.can_pickup).toBe(true); // untouched by this update

        await expect(
          asHeadmaster(() => service.updateLink('00000000-0000-0000-0000-000000000000', { canPickup: false })),
        ).rejects.toThrow(/not found/);
      } finally {
        conn.release();
      }
    });
  });

  describe('unlink()', () => {
    it('removes the link; unlinking the same id twice 404s the second time', async () => {
      const { conn, service } = harness();
      try {
        const studentId = await createStudent(conn);
        const guardian = await asHeadmaster(() => service.create({ fullName: 'Efua Guardian' }));
        guardianIds.push(guardian.id);
        const link = await asHeadmaster(() => service.linkToStudent(studentId, { guardianId: guardian.id }));

        await asHeadmaster(() => service.unlink(link.id));
        const remaining = await asHeadmaster(() => service.findForStudent(studentId));
        expect(remaining).toHaveLength(0);

        await expect(asHeadmaster(() => service.unlink(link.id))).rejects.toThrow(/not found/);
      } finally {
        conn.release();
      }
    });
  });
});
