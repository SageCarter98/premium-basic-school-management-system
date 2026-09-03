/**
 * timetable.e2e-spec.ts
 *
 * Chapter 17 (Timetable builder/views, spec §7.6) — FR-ACA-040: "Detect
 * teacher, class and room conflicts before a timetable can be published;
 * provide class, teacher and room views." TimetableService had zero test
 * coverage before this file, despite 0033_timetable.sql already seeding
 * one active entry for Tenant A specifically so this file wouldn't need
 * to build the base fixture from scratch (id a8200000-...0001: teacher
 * 99999999-...0003, class dddddddd-...0001, room a8000000-...0001,
 * period a8100000-...0001, monday).
 *
 * Covers:
 *  - createEntry(): each of the three conflict rules 409s independently
 *    against that seeded entry (same slot, only one of teacher/class/room
 *    shared at a time, via a throwaway second teacher+class fixture so
 *    the three checks can be isolated from each other) — the seeded
 *    entry's own teacher+class+room combination means the teacher check
 *    (which runs first in the service) would otherwise mask the class/
 *    room checks.
 *  - A genuinely free slot (same period, a different day) succeeds.
 *  - end(): the happy path, a 409 on an already-ended entry, a 404 via
 *    findOne() on an unknown id.
 *  - Ending an entry frees its slot: creating a new entry at the exact
 *    slot just vacated succeeds where it would otherwise have conflicted.
 *
 * Harness pattern copied from discipline.e2e-spec.ts (WorkerTenantConnection
 * + TenantContextStore.run() idiom, per-file fixture tracking, afterAll
 * cleanup). Requires a running Postgres with every migration through
 * 0040_period_day_variation.sql (and seed_demo.sql) applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { TimetableService } from '../src/modules/timetable/timetable.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001';
const SUBJECT_A = '55555555-0000-0000-0000-000000000001'; // Mathematics
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise
const TEACHER_SEEDED = '99999999-0000-0000-0000-000000000003'; // teacher@sunrise — the seeded entry's teacher
const CLASS_SEEDED = 'dddddddd-0000-0000-0000-000000000001'; // the seeded entry's class
const ROOM_SEEDED = 'a8000000-0000-0000-0000-000000000001'; // the seeded entry's room
const PERIOD_SEEDED = 'a8100000-0000-0000-0000-000000000001'; // generic (day_of_week null) — applies every day

function asHeadmaster<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Timetable (Chapter 17, FR-ACA-040)', () => {
  let pool: Pool;
  const userIds: string[] = [];
  const classIds: string[] = [];
  const entryIds: string[] = [];
  let teacher2: string;
  let class2: string;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asHeadmaster(async () => {
        await cleanup.query(`delete from timetable_entries where id = any($1::uuid[])`, [entryIds]);
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from tenant_users where user_id = any($1::uuid[])`, [userIds]);
      });
      await cleanup.query(`delete from users where id = any($1::uuid[])`, [userIds]);
    } finally {
      cleanup.release();
      await pool.end();
    }
  }, 30000);

  function harness(): { conn: WorkerTenantConnection; service: TimetableService } {
    const conn = new WorkerTenantConnection(pool);
    return { conn, service: new TimetableService(conn) };
  }

  beforeAll(async () => {
    const { conn } = harness();
    // A throwaway second teacher, so the class/room conflict checks can be
    // exercised without also tripping the (earlier-running) teacher check.
    const userRows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into users (email, password_hash, full_name) values ($1, 'x', 'FR-ACA-040 Fixture Teacher') returning id`,
        [`${uniqueName('fr-aca-040')}@fixture.test`],
      ),
    );
    teacher2 = userRows[0].id;
    userIds.push(teacher2);
    await asHeadmaster(() =>
      conn.query(`insert into tenant_users (tenant_id, user_id, role_code) values (current_tenant_id(), $1, 'teacher')`, [
        teacher2,
      ]),
    );

    const classRows = await asHeadmaster(() =>
      conn.query<{ id: string }>(
        `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4) returning id`,
        [ACADEMIC_YEAR_A, uniqueName('FR-ACA-040 Class'), 'JHS 2', HEADMASTER],
      ),
    );
    class2 = classRows[0].id;
    classIds.push(class2);
    conn.release();
  });

  function baseEntry(overrides: Partial<Parameters<TimetableService['createEntry']>[0]> = {}) {
    return {
      academicYearId: ACADEMIC_YEAR_A,
      classId: class2,
      subjectId: SUBJECT_A,
      teacherId: teacher2,
      periodId: PERIOD_SEEDED,
      dayOfWeek: 'monday' as const,
      ...overrides,
    };
  }

  it('a teacher already active at this slot 409s, naming the conflicting entry', async () => {
    const { conn, service } = harness();
    try {
      await expect(asHeadmaster(() => service.createEntry(baseEntry({ teacherId: TEACHER_SEEDED })))).rejects.toThrow(
        /teacher .* already has an active entry/,
      );
    } finally {
      conn.release();
    }
  });

  it('a class already active at this slot 409s (isolated from the teacher check via a fixture teacher)', async () => {
    const { conn, service } = harness();
    try {
      await expect(asHeadmaster(() => service.createEntry(baseEntry({ classId: CLASS_SEEDED })))).rejects.toThrow(
        /class .* already has an active entry/,
      );
    } finally {
      conn.release();
    }
  });

  it('a room already booked at this slot 409s (isolated from the teacher/class checks)', async () => {
    const { conn, service } = harness();
    try {
      await expect(asHeadmaster(() => service.createEntry(baseEntry({ roomId: ROOM_SEEDED })))).rejects.toThrow(
        /room .* is already booked/,
      );
    } finally {
      conn.release();
    }
  });

  it('a genuinely free slot (same period, a different day) succeeds', async () => {
    const { conn, service } = harness();
    try {
      const entry = await asHeadmaster(() => service.createEntry(baseEntry({ dayOfWeek: 'tuesday' })));
      entryIds.push(entry.id);
      expect(entry.status).toBe('active');
      expect(entry.day_of_week).toBe('tuesday');
    } finally {
      conn.release();
    }
  });

  describe('end()', () => {
    it('ends an active entry; a second end() 409s; an unknown id 404s via findOne()', async () => {
      const { conn, service } = harness();
      try {
        const entry = await asHeadmaster(() => service.createEntry(baseEntry({ dayOfWeek: 'wednesday' })));
        entryIds.push(entry.id);

        const ended = await asHeadmaster(() => service.end(entry.id, 'test teardown'));
        expect(ended.status).toBe('ended');
        expect(ended.ended_reason).toBe('test teardown');

        await expect(asHeadmaster(() => service.end(entry.id))).rejects.toThrow(/already ended/);
        await expect(asHeadmaster(() => service.end('00000000-0000-0000-0000-000000000000'))).rejects.toThrow(
          /not found/,
        );
      } finally {
        conn.release();
      }
    });

    it('frees the slot: a new entry at the exact slot just vacated succeeds where it would otherwise conflict', async () => {
      const { conn, service } = harness();
      try {
        const first = await asHeadmaster(() => service.createEntry(baseEntry({ dayOfWeek: 'thursday' })));
        entryIds.push(first.id);

        await expect(asHeadmaster(() => service.createEntry(baseEntry({ dayOfWeek: 'thursday' })))).rejects.toThrow(
          /already has an active entry/,
        );

        await asHeadmaster(() => service.end(first.id));
        const second = await asHeadmaster(() => service.createEntry(baseEntry({ dayOfWeek: 'thursday' })));
        entryIds.push(second.id);
        expect(second.status).toBe('active');
      } finally {
        conn.release();
      }
    });
  });

  describe('findAllEntries() — the "views" half of FR-ACA-040', () => {
    it('filters by teacherId', async () => {
      const { conn, service } = harness();
      try {
        const rows = await asHeadmaster(() => service.findAllEntries({ teacherId: teacher2 }));
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.teacher_id === teacher2)).toBe(true);
      } finally {
        conn.release();
      }
    });
  });
});
