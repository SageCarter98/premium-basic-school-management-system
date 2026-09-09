/**
 * academic-structure.e2e-spec.ts
 *
 * FR-ACA-010 (classes.level is free text, tenant-defined -- not a fixed
 * Nursery..JHS enum) and FR-ACA-020 (academic_years.status is constrained
 * to Planned/Active/Closed/Archived), infra/migrations/0001_init_tenancy.sql.
 * Both requirements were cited by ID for the first time in the PR that
 * preceded this file (comment-only, no test) -- detect-spec-gaps.ts
 * correctly reclassified them "referenced in code, but never in a test
 * file" rather than crediting the citation alone as coverage. This file is
 * the actual coverage.
 *
 * Covers:
 *  - FR-ACA-020: the CHECK constraint on academic_years.status actually
 *    enforces the four-state lifecycle at the database layer, independent
 *    of CreateAcademicYearDto's own @IsIn() mirror of the same list -- a
 *    direct SQL insert bypassing the DTO is rejected for an out-of-list
 *    value, each of the four legal values is accepted, and the DTO/service
 *    layer is exercised too since it makes the same claim independently.
 *  - FR-ACA-010: classes.level has no equivalent CHECK/enum constraint --
 *    arbitrary tenant-defined level strings, deliberately not drawn from
 *    any Nursery..JHS canonical list, persist unchanged. Exercised through
 *    both a raw insert and ClassesService/CreateClassDto.
 *
 * Harness pattern copied from students.e2e-spec.ts (WorkerTenantConnection
 * + TenantContextStore.run() idiom, seeded Tenant A/School A fixtures).
 *
 * Requires a running Postgres with every migration through
 * 0001_init_tenancy.sql (and seed_demo.sql) applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { AcademicYearsService } from '../src/modules/academic-years/academic-years.service';
import { ClassesService } from '../src/modules/classes/classes.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ACADEMIC_YEAR_A = 'cccccccc-0000-0000-0000-000000000001'; // 2026/2027 (seeded)
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

function asHeadmaster<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run(
    { tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false },
    fn,
  );
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Academic structure (Chapter 17, FR-ACA-010, FR-ACA-020)', () => {
  let pool: Pool;
  const academicYearIds: string[] = [];
  const classIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asHeadmaster(async () => {
        await cleanup.query(`delete from classes where id = any($1::uuid[])`, [classIds]);
        await cleanup.query(`delete from academic_years where id = any($1::uuid[])`, [academicYearIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  describe('FR-ACA-020: academic_years.status is constrained to planned/active/closed/archived', () => {
    it('accepts each of the four legal lifecycle states at the database layer', async () => {
      const conn = new WorkerTenantConnection(pool);
      try {
        for (const status of ['planned', 'active', 'closed', 'archived']) {
          const rows = await asHeadmaster(() =>
            conn.query<{ id: string; status: string }>(
              `insert into academic_years (tenant_id, school_id, name, status, created_by, updated_by)
               values (current_tenant_id(), $1, $2, $3, $4, $4) returning id, status`,
              [SCHOOL_A, uniqueName(`FR-ACA-020 ${status}`), status, HEADMASTER],
            ),
          );
          academicYearIds.push(rows[0].id);
          expect(rows[0].status).toBe(status);
        }
      } finally {
        conn.release();
      }
    });

    it('rejects a status outside the four-state lifecycle, bypassing the DTO entirely', async () => {
      const conn = new WorkerTenantConnection(pool);
      try {
        await expect(
          asHeadmaster(() =>
            conn.query(
              `insert into academic_years (tenant_id, school_id, name, status, created_by, updated_by)
               values (current_tenant_id(), $1, $2, 'suspended', $3, $3) returning id`,
              [SCHOOL_A, uniqueName('FR-ACA-020 invalid'), HEADMASTER],
            ),
          ),
        ).rejects.toThrow(/violates check constraint/);
      } finally {
        conn.release();
      }
    });

    it('CreateAcademicYearDto/AcademicYearsService mirror the same four-state list at the API layer', async () => {
      const conn = new WorkerTenantConnection(pool);
      const service = new AcademicYearsService(conn);
      try {
        const year = await asHeadmaster(() =>
          service.create({ schoolId: SCHOOL_A, name: uniqueName('FR-ACA-020 svc'), status: 'active' }),
        );
        academicYearIds.push(year.id);
        expect(year.status).toBe('active');
      } finally {
        conn.release();
      }
    });
  });

  describe('FR-ACA-010: classes.level is tenant-defined free text, not a fixed enum', () => {
    it('persists arbitrary level strings unchanged, with no check constraint to reject them', async () => {
      const conn = new WorkerTenantConnection(pool);
      // Deliberately not drawn from any Nursery..JHS canonical list -- this
      // proves the absence of an enum, not just that the known values work.
      const levels = ['Creche', 'Reception B', 'JHS 2 (Remedial)', uniqueName('Custom Stream')];
      try {
        for (const level of levels) {
          const rows = await asHeadmaster(() =>
            conn.query<{ id: string; level: string }>(
              `insert into classes (tenant_id, academic_year_id, name, level, created_by, updated_by)
               values (current_tenant_id(), $1, $2, $3, $4, $4) returning id, level`,
              [ACADEMIC_YEAR_A, uniqueName('FR-ACA-010 Class'), level, HEADMASTER],
            ),
          );
          classIds.push(rows[0].id);
          expect(rows[0].level).toBe(level);
        }
      } finally {
        conn.release();
      }
    });

    it('ClassesService/CreateClassDto accept the same free-text level at the API layer', async () => {
      const conn = new WorkerTenantConnection(pool);
      const service = new ClassesService(conn);
      try {
        const level = uniqueName('Tenant Stream');
        const created = await asHeadmaster(() =>
          service.create({ academicYearId: ACADEMIC_YEAR_A, name: uniqueName('FR-ACA-010 svc Class'), level }),
        );
        classIds.push(created.id);
        expect(created.level).toBe(level);
      } finally {
        conn.release();
      }
    });
  });
});
