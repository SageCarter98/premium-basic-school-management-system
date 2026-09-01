/**
 * guardian-access.e2e-spec.ts
 *
 * Stage 6 Parent View onboarding (spec §6.3/§8.6, guardians.service.ts) —
 * genuinely untested before this file. Companion to guardians.e2e-spec.ts,
 * which covers the core directory/link CRUD; this file covers how a
 * guardian actually gets Parent View access in the first place.
 *
 * Covers:
 *  - createAccessGrant()/listAccessGrants()/revokeAccessGrant(): a grant
 *    is minted with a real one-time token, listed afterward, revoked
 *    once (a second revoke of the same id 409s — "not found or already
 *    revoked", never a silent no-op).
 *  - submitAccessRequest() — the one public, unauthenticated write in
 *    this module: a real school code + admission number creates a
 *    'pending' row; a mismatch on either gets the same generic
 *    NotFoundException (can't be used to enumerate which part was
 *    wrong); the rate limit (5 attempts/60min per school+admission
 *    number key) rejects the 6th attempt with 429.
 *  - approveAccessRequest()/rejectAccessRequest(): both refuse a
 *    non-'pending' request; approve creates a real guardian + link +
 *    access grant in one call and flips status to 'approved'; reject
 *    flips to 'rejected' with review notes recorded.
 *
 * guardian_access_grants/guardian_access_requests/
 * guardian_access_request_attempts all grant pbsms_app select+insert(
 * +update where relevant) but never delete (0031_guardian_access.sql,
 * 0043_guardian_access_requests.sql — deliberately: revocation/review is
 * an UPDATE flag, never a row deletion) — same append-only teardown gap
 * transport.e2e-spec.ts hit, so cleanup here uses the schema-owning role
 * throughout, not just for one table.
 *
 * Requires a running Postgres with every migration through
 * 0043_guardian_access_requests.sql (and seed_demo.sql) applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { PG_POOL } from '../src/common/database/tenant-database.service';
import { GuardiansService } from '../src/modules/guardians/guardians.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SCHOOL_A_CODE = 'SUN';
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

function asHeadmaster<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Guardian access grants/requests (Stage 6 Parent View onboarding)', () => {
  let pool: Pool;
  let cleanupPool: Pool;
  const studentIds: string[] = [];
  const guardianIds: string[] = [];
  const linkIds: string[] = [];
  const grantIds: string[] = [];
  const requestIds: string[] = [];
  const rateLimitKeys: { schoolCode: string; admissionNo: string }[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
    cleanupPool = new Pool({ connectionString: process.env.MIGRATE_DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await cleanupPool.query(`delete from guardian_access_grants where id = any($1::uuid[])`, [grantIds]);
      await cleanupPool.query(`delete from guardian_access_requests where id = any($1::uuid[])`, [requestIds]);
      for (const key of rateLimitKeys) {
        await cleanupPool.query(`delete from guardian_access_request_attempts where school_code = $1 and admission_no = $2`, [
          key.schoolCode,
          key.admissionNo,
        ]);
      }
      await asHeadmaster(async () => {
        await cleanup.query(`delete from student_guardians where id = any($1::uuid[])`, [linkIds]);
        await cleanup.query(`delete from guardians where id = any($1::uuid[])`, [guardianIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
      });
    } finally {
      cleanup.release();
      await cleanupPool.end();
      await pool.end();
    }
  }, 30000);

  function harness(): { conn: WorkerTenantConnection; service: GuardiansService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new GuardiansService(conn, pool as unknown as typeof PG_POOL & Pool) };
  }

  async function createStudent(conn: WorkerTenantConnection, admissionNo = uniqueName('ADM')): Promise<{ id: string; admissionNo: string }> {
    const rows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-STU-020', 'Fixture', $3, $3) returning id`,
        [SCHOOL_A, admissionNo, HEADMASTER],
      ),
    );
    studentIds.push(rows[0].id);
    return { id: rows[0].id, admissionNo };
  }

  describe('createAccessGrant()/listAccessGrants()/revokeAccessGrant()', () => {
    it('mints a real token, lists it, refuses a second revoke of the same grant', async () => {
      const { conn, service } = harness();
      try {
        const guardian = await asHeadmaster(() => service.create({ fullName: 'Fixture Guardian' }));
        guardianIds.push(guardian.id);

        const { grant, token } = await asHeadmaster(() => service.createAccessGrant(guardian.id, 30));
        grantIds.push(grant.id);
        expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
        expect(grant.revoked_at).toBeNull();

        const listed = await asHeadmaster(() => service.listAccessGrants(guardian.id));
        expect(listed.map((g) => g.id)).toContain(grant.id);

        const revoked = await asHeadmaster(() => service.revokeAccessGrant(grant.id));
        expect(revoked.revoked_at).not.toBeNull();

        await expect(asHeadmaster(() => service.revokeAccessGrant(grant.id))).rejects.toThrow(/not found or already revoked/);
      } finally {
        conn.release();
      }
    });
  });

  describe('submitAccessRequest()', () => {
    it('creates a pending request for a real school+admission match, the same generic 404 either way it mismatches', async () => {
      const { conn, service } = harness();
      try {
        const student = await createStudent(conn);
        rateLimitKeys.push({ schoolCode: SCHOOL_A_CODE, admissionNo: student.admissionNo });

        const wrongSchool = { schoolCode: 'NOPE', admissionNo: student.admissionNo };
        rateLimitKeys.push(wrongSchool);
        await expect(
          service.submitAccessRequest({ ...wrongSchool, requesterName: 'Someone' } as never),
        ).rejects.toThrow(/Could not find a matching student/);

        const wrongAdmission = { schoolCode: SCHOOL_A_CODE, admissionNo: uniqueName('BOGUS') };
        rateLimitKeys.push(wrongAdmission);
        await expect(
          service.submitAccessRequest({ ...wrongAdmission, requesterName: 'Someone' } as never),
        ).rejects.toThrow(/Could not find a matching student/);

        await service.submitAccessRequest({
          schoolCode: SCHOOL_A_CODE,
          admissionNo: student.admissionNo,
          requesterName: 'Kwabena Requester',
          requesterPhone: '+233241111111',
          relationship: 'father',
        } as never);

        const pending = await asHeadmaster(() => service.findAllAccessRequests('pending'));
        const created = pending.find((r) => r.student_id === student.id);
        expect(created).toBeDefined();
        requestIds.push(created!.id);
      } finally {
        conn.release();
      }
    });

    it('rate-limits repeated attempts against the same school+admission key to 5 per 60 minutes', async () => {
      const { conn, service } = harness();
      try {
        const key = { schoolCode: SCHOOL_A_CODE, admissionNo: uniqueName('RATE') };
        rateLimitKeys.push(key);

        for (let i = 0; i < 5; i++) {
          await expect(service.submitAccessRequest({ ...key, requesterName: 'Rate Test' } as never)).rejects.toThrow(
            /Could not find a matching student/,
          );
        }

        await expect(service.submitAccessRequest({ ...key, requesterName: 'Rate Test' } as never)).rejects.toThrow(
          /Too many requests/,
        );
      } finally {
        conn.release();
      }
    });
  });

  describe('approveAccessRequest()/rejectAccessRequest()', () => {
    it('approve creates a real guardian+link+grant and refuses a second decision either way', async () => {
      const { conn, service } = harness();
      try {
        const student = await createStudent(conn);
        rateLimitKeys.push({ schoolCode: SCHOOL_A_CODE, admissionNo: student.admissionNo });
        await service.submitAccessRequest({
          schoolCode: SCHOOL_A_CODE,
          admissionNo: student.admissionNo,
          requesterName: 'Ama Requester',
          relationship: 'mother',
        } as never);
        const pending = await asHeadmaster(() => service.findAllAccessRequests('pending'));
        const request = pending.find((r) => r.student_id === student.id)!;
        requestIds.push(request.id);

        const approved = await asHeadmaster(() =>
          service.approveAccessRequest(request.id, { isPrimaryContact: true, hasReportAccess: true } as never),
        );
        guardianIds.push(approved.guardian.id);
        linkIds.push(approved.link.id);
        // approveAccessRequest() returns only the raw token, not the
        // grant row it minted via createAccessGrant() — fetch it back for
        // cleanup tracking.
        const mintedGrants = await asHeadmaster(() => service.listAccessGrants(approved.guardian.id));
        grantIds.push(...mintedGrants.map((g) => g.id));
        expect(approved.request.status).toBe('approved');
        expect(approved.guardian.full_name).toBe('Ama Requester');
        expect(approved.link.student_id).toBe(student.id);
        expect(approved.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);

        await expect(
          asHeadmaster(() => service.approveAccessRequest(request.id, {} as never)),
        ).rejects.toThrow(/is 'approved', not 'pending'/);
      } finally {
        conn.release();
      }
    });

    it('reject flips status to rejected with review notes, refusing a second decision', async () => {
      const { conn, service } = harness();
      try {
        const student = await createStudent(conn);
        rateLimitKeys.push({ schoolCode: SCHOOL_A_CODE, admissionNo: student.admissionNo });
        await service.submitAccessRequest({
          schoolCode: SCHOOL_A_CODE,
          admissionNo: student.admissionNo,
          requesterName: 'Suspicious Requester',
        } as never);
        const pending = await asHeadmaster(() => service.findAllAccessRequests('pending'));
        const request = pending.find((r) => r.student_id === student.id)!;
        requestIds.push(request.id);

        const rejected = await asHeadmaster(() => service.rejectAccessRequest(request.id, 'Could not verify relationship'));
        expect(rejected.status).toBe('rejected');
        expect(rejected.review_notes).toBe('Could not verify relationship');

        await expect(asHeadmaster(() => service.rejectAccessRequest(request.id))).rejects.toThrow(/is 'rejected', not 'pending'/);
      } finally {
        conn.release();
      }
    });
  });
});
