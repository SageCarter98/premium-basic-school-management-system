/**
 * tenant-isolation.e2e-spec.ts
 *
 * Implements SRS v2.1 NFR-QA-020:
 *   "Cross-tenant access attempts are a mandatory, first-class test
 *    category — every endpoint, report, export and background job is
 *    tested with a second tenant's credentials attempting to read or
 *    write the first tenant's data, and the suite fails the build if
 *    any such attempt succeeds."
 *
 * This file tests the foundation that every other cross-tenant test in
 * the codebase will rely on: that Row-Level Security actually does what
 * Chapter 1 says it does, at the database level, independent of any
 * application code. As real feature modules are built (students, results,
 * invoices, ...), copy this file's pattern for each of them — this is not
 * a one-off test, it is the template. A module without its own copy of
 * this test does not meet NFR-QA-020 and should not pass review.
 *
 * Requires a running Postgres with 0001_init_tenancy.sql and
 * seed_demo.sql already applied. See package.json "test:e2e" and the
 * root README for how CI wires this up.
 */

import { Pool } from 'pg';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const TENANT_B = '22222222-2222-2222-2222-222222222222'; // Golden Gate Schools Group
const STUDENT_IN_TENANT_A = 'eeeeeeee-0000-0000-0000-000000000001'; // Ama Mensah
const ENROLMENT_IN_TENANT_A = 'ffffffff-0000-0000-0000-000000000001';
const APPLICANT_IN_TENANT_A = '33333333-0000-0000-0000-000000000001';
const ATTENDANCE_RECORD_IN_TENANT_A = '44444444-0000-0000-0000-000000000001';
const SUBJECT_IN_TENANT_A = '55555555-0000-0000-0000-000000000001';
const ASSESSMENT_STRUCTURE_IN_TENANT_A = '66666666-0000-0000-0000-000000000001';
const SCORE_IN_TENANT_A = '88888888-0000-0000-0000-000000000001';
const GRADING_POLICY_IN_TENANT_A = 'a0000000-0000-0000-0000-000000000001';
const SCALE_ITEM_IN_TENANT_A = 'a1111111-0000-0000-0000-000000000001';
const RESULT_CANDIDATE_IN_TENANT_A = 'a3333333-0000-0000-0000-000000000001';
const STUDENT_RESULT_IN_TENANT_A = 'b0000000-0000-0000-0000-000000000001';
const STUDENT_RESULT_ITEM_IN_TENANT_A = 'b1111111-0000-0000-0000-000000000001';
const TENANT_BRANDING_IN_TENANT_A = 'c0000000-0000-0000-0000-000000000001';
const PROMOTION_DECISION_IN_TENANT_A = 'c1111111-0000-0000-0000-000000000001';
const GENERATED_DOCUMENT_IN_TENANT_A = 'c2222222-0000-0000-0000-000000000001';
const FEE_STRUCTURE_IN_TENANT_A = 'd0000000-0000-0000-0000-000000000001';
const FEE_STRUCTURE_ITEM_IN_TENANT_A = 'd1111111-0000-0000-0000-000000000001';
const FEE_INSTALMENT_IN_TENANT_A = 'd3333333-0000-0000-0000-000000000001';
const INVOICE_IN_TENANT_A = 'd5555555-0000-0000-0000-000000000001';
const INVOICE_ITEM_IN_TENANT_A = 'd6666666-0000-0000-0000-000000000001';
const PAYMENT_IN_TENANT_A = 'd7777777-0000-0000-0000-000000000001';
const PAYMENT_ALLOCATION_IN_TENANT_A = 'd8888888-0000-0000-0000-000000000001';
const FEE_PENALTY_RULE_IN_TENANT_A = 'd9999999-0000-0000-0000-000000000001';
const FEE_PENALTY_CHARGE_IN_TENANT_A = 'da000000-0000-0000-0000-000000000001';
const FINANCIAL_ASSISTANCE_IN_TENANT_A = 'e0000000-0000-0000-0000-000000000001';
const REVERSAL_IN_TENANT_A = 'e2222222-0000-0000-0000-000000000001';
const NOTIFICATION_TEMPLATE_IN_TENANT_A = 'f0000000-0000-0000-0000-000000000001';
const COMMUNICATION_PREFERENCE_IN_TENANT_A = 'f1111111-0000-0000-0000-000000000001';
const NOTIFICATION_IN_TENANT_A = 'f2222222-0000-0000-0000-000000000001';
const NOTIFICATION_DELIVERY_IN_TENANT_A = 'f3333333-0000-0000-0000-000000000001';
const TENANT_COMMUNICATION_SETTINGS_IN_TENANT_A = 'f4444444-0000-0000-0000-000000000001';
const NOTIFICATION_REPORT_IN_TENANT_A = 'f5555555-0000-0000-0000-000000000001';
const NOTIFICATION_REPORT_COMMENT_IN_TENANT_A = 'f6666666-0000-0000-0000-000000000001';
const DISCIPLINE_CASE_IN_TENANT_A = 'f7777777-0000-0000-0000-000000000001';
const DISCIPLINE_CASE_NOTE_IN_TENANT_A = 'f8888888-0000-0000-0000-000000000001';
const DISCIPLINE_CASE_RESPONSE_IN_TENANT_A = 'f9999999-0000-0000-0000-000000000001';
const DISCIPLINE_GUARDIAN_CONTACT_IN_TENANT_A = 'faaaaaaa-0000-0000-0000-000000000001';
const DISCIPLINE_APPEAL_IN_TENANT_A = 'fbbbbbbb-0000-0000-0000-000000000001';
const DISCIPLINE_RECOGNITION_IN_TENANT_A = 'fccccccc-0000-0000-0000-000000000001';
const LIBRARY_ITEM_IN_TENANT_A = '70000000-0000-0000-0000-000000000001';
const LIBRARY_MEMBER_IN_TENANT_A = '71111111-0000-0000-0000-000000000001';
const LIBRARY_LOAN_IN_TENANT_A = '72222222-0000-0000-0000-000000000001';
const TRANSPORT_ROUTE_IN_TENANT_A = '73333333-0000-0000-0000-000000000001';
const TRANSPORT_STOP_IN_TENANT_A = '74444444-0000-0000-0000-000000000001';
const TRANSPORT_VEHICLE_IN_TENANT_A = '75555555-0000-0000-0000-000000000001';
const TRANSPORT_DRIVER_IN_TENANT_A = '76666666-0000-0000-0000-000000000001';
const TRANSPORT_ASSIGNMENT_IN_TENANT_A = '77777777-0000-0000-0000-000000000001';
const HEALTH_RECORD_IN_TENANT_A = '78888888-0000-0000-0000-000000000001';
const HEALTH_INCIDENT_IN_TENANT_A = '79999999-0000-0000-0000-000000000001';
const HEALTH_GUARDIAN_CONTACT_IN_TENANT_A = '7aaaaaaa-0000-0000-0000-000000000001';
const MEDICATION_LOG_IN_TENANT_A = '7bbbbbbb-0000-0000-0000-000000000001';
const INVENTORY_ITEM_IN_TENANT_A = '7ccccccc-0000-0000-0000-000000000001';
const INVENTORY_ISSUANCE_IN_TENANT_A = '7ddddddd-0000-0000-0000-000000000001';
const INVENTORY_ALERT_IN_TENANT_A = '7eeeeeee-0000-0000-0000-000000000001';
const AUDIT_LOG_IN_TENANT_A = '7fffffff-0000-0000-0000-000000000001';
const TENANT_USER_IN_TENANT_A = '80000000-0000-0000-0000-000000000001'; // teacher@sunrise's membership row
const GUARDIAN_IN_TENANT_A = '90000000-0000-0000-0000-000000000001'; // Ama Mensah's guardian
const STUDENT_GUARDIAN_LINK_IN_TENANT_A = '91111111-0000-0000-0000-000000000001';
const GUARDIAN_ACCESS_GRANT_IN_TENANT_A = '92222222-0000-0000-0000-000000000001'; // Ama Mensah's guardian's Parent View link
const TEACHER_ASSIGNMENT_IN_TENANT_A = '92000000-0000-0000-0000-000000000001'; // teacher@sunrise / JHS 2A / Mathematics
const ROLE_DELEGATION_IN_TENANT_A = '93000000-0000-0000-0000-000000000001'; // headmaster -> teacher@sunrise
const BACKGROUND_JOB_IN_TENANT_A = '94000000-0000-0000-0000-000000000001'; // queued report_card_batch job
const JOB_SCHEDULE_IN_TENANT_A = '95000000-0000-0000-0000-000000000001'; // termly report_card_batch schedule
const KPI_DEFINITION_IN_TENANT_A = '96000000-0000-0000-0000-000000000001'; // collection-rate KPI
const KPI_SNAPSHOT_IN_TENANT_A = '96100000-0000-0000-0000-000000000001'; // Q1 2026 snapshot
const DATA_SUBJECT_REQUEST_IN_TENANT_A = '97000000-1000-0000-0000-000000000001'; // Ama Mensah's guardian access request
const CONSENT_RECORD_IN_TENANT_A = '97000000-2000-0000-0000-000000000001'; // Ama Mensah's guardian SMS consent
const SCHOOL_ACADEMIC_SETTINGS_IN_TENANT_A = 'a1000000-0000-0000-0000-000000000001'; // Sunrise: NaCCA opted in
const CURRICULUM_STRAND_IN_TENANT_A = 'a2000000-0000-0000-0000-000000000001'; // Mathematics / Number
const CURRICULUM_SUB_STRAND_IN_TENANT_A = 'a3000000-0000-0000-0000-000000000001'; // Number and Numeration
const CURRICULUM_INDICATOR_IN_TENANT_A = 'a4000000-0000-0000-0000-000000000001'; // B7.1.1.1.1
const BECE_CANDIDATE_IN_TENANT_A = 'a5000000-0000-0000-0000-000000000001'; // Ama Mensah, SUN-20262027-0001
const BECE_MOCK_RESULT_IN_TENANT_A = 'a6000000-0000-0000-0000-000000000001'; // Mock 1 2026 Mathematics, grade 3
const CSSPS_PLACEMENT_IN_TENANT_A = 'a7000000-0000-0000-0000-000000000001'; // Ama Mensah's CSSPS choices
const ROOM_IN_TENANT_A = 'a8000000-0000-0000-0000-000000000001'; // Block A - Room 1
const PERIOD_IN_TENANT_A = 'a8100000-0000-0000-0000-000000000001'; // Period 1, 08:00-08:40
const TIMETABLE_ENTRY_IN_TENANT_A = 'a8200000-0000-0000-0000-000000000001'; // JHS 2A / Mathematics / teacher@sunrise, Monday P1
const SETTLEMENT_BATCH_IN_TENANT_A = 'a9000000-0000-0000-0000-000000000001'; // August 2026 bank statement
const SETTLEMENT_LINE_IN_TENANT_A = 'a9100000-0000-0000-0000-000000000001'; // CASH-0001, 600, unmatched

describe('Tenant isolation (NFR-QA-020)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function queryAsTenant<T = Record<string, unknown>>(
    tenantId: string | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const client = await pool.connect();
    try {
      if (tenantId) {
        // SET does not accept bind parameters; set_config() does.
        await client.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
      } else {
        await client.query('RESET app.current_tenant');
      }
      const result = await client.query(sql, params);
      return result.rows;
    } finally {
      // Always reset before releasing, mirroring TEN-004 — a test that
      // "forgets" this would itself leak context into the next test.
      await client.query('RESET app.current_tenant');
      client.release();
    }
  }

  it('Tenant A can see its own student', async () => {
    const rows = await queryAsTenant(TENANT_A, 'select id, first_name, last_name from students');
    expect(rows).toHaveLength(1);
    expect(rows[0].first_name).toBe('Ama');
    expect(rows[0].last_name).toBe('Mensah');
  });

  it('Tenant B CANNOT see Tenant A\'s student by listing', async () => {
    const rows = await queryAsTenant(TENANT_B, 'select id, first_name, last_name from students');
    expect(rows).toHaveLength(1); // Tenant B sees only its own student
    expect(rows.find((r) => r.id === STUDENT_IN_TENANT_A)).toBeUndefined();
  });

  it('Tenant B CANNOT see Tenant A\'s student by direct id lookup either', async () => {
    // This is the more dangerous case: an authenticated Tenant B user who
    // knows or guesses a Tenant A student's UUID and requests it directly.
    const rows = await queryAsTenant(TENANT_B, 'select * from students where id = $1', [
      STUDENT_IN_TENANT_A,
    ]);
    expect(rows).toHaveLength(0); // not "forbidden" — genuinely invisible, per RLS design intent
  });

  it('Tenant B CANNOT update Tenant A\'s student', async () => {
    const rows = await queryAsTenant<{ id: string }>(
      TENANT_B,
      `update students set last_name = 'HACKED' where id = $1 returning id`,
      [STUDENT_IN_TENANT_A],
    );
    expect(rows).toHaveLength(0); // zero rows affected — RLS's WITH CHECK clause blocks the write

    // Confirm as Tenant A that the record is untouched.
    const check = await queryAsTenant<{ last_name: string }>(
      TENANT_A,
      'select last_name from students where id = $1',
      [STUDENT_IN_TENANT_A],
    );
    expect(check[0].last_name).toBe('Mensah');
  });

  it('A session with NO tenant context set sees zero rows, not all rows (fail-safe, not fail-open)', async () => {
    const rows = await queryAsTenant(null, 'select id from students');
    expect(rows).toHaveLength(0);
  });

  it('A session with an unknown/garbage tenant id sees zero rows, not an error and not all rows', async () => {
    const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from students');
    expect(rows).toHaveLength(0);
  });

  // enrolments is the most relationship-heavy table added so far (three FKs:
  // student, academic year, class — see modules/enrolments/enrolments.service.ts)
  // so it's the one this suite extends to, per the pattern's own instructions
  // in the header comment above: "copy this file's pattern for each of them."
  describe('enrolments', () => {
    it('Tenant A can see its own enrolment', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, student_id from enrolments');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(ENROLMENT_IN_TENANT_A);
    });

    it("Tenant B CANNOT see Tenant A's enrolment by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from enrolments');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === ENROLMENT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's enrolment by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from enrolments where id = $1', [
        ENROLMENT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's enrolment", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update enrolments set closed_reason = 'HACKED' where id = $1 returning id`,
        [ENROLMENT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ closed_reason: string | null }>(
        TENANT_A,
        'select closed_reason from enrolments where id = $1',
        [ENROLMENT_IN_TENANT_A],
      );
      expect(check[0].closed_reason).toBeNull();
    });

    it('A session with NO tenant context set sees zero enrolment rows', async () => {
      const rows = await queryAsTenant(null, 'select id from enrolments');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero enrolment rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from enrolments');
      expect(rows).toHaveLength(0);
    });
  });

  // applicants (0002_admissions.sql) — same pattern again, per this file's
  // own "copy this file's pattern for each of them" instruction.
  describe('applicants', () => {
    it('Tenant A can see its own applicant', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, first_name, last_name from applicants');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(APPLICANT_IN_TENANT_A);
      expect(rows[0].last_name).toBe('Boateng');
    });

    it("Tenant B CANNOT see Tenant A's applicant by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from applicants');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === APPLICANT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's applicant by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from applicants where id = $1', [
        APPLICANT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's applicant", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update applicants set status = 'cancelled' where id = $1 returning id`,
        [APPLICANT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from applicants where id = $1',
        [APPLICANT_IN_TENANT_A],
      );
      expect(check[0].status).toBe('draft');
    });

    it('A session with NO tenant context set sees zero applicant rows', async () => {
      const rows = await queryAsTenant(null, 'select id from applicants');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero applicant rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from applicants');
      expect(rows).toHaveLength(0);
    });
  });

  // attendance_records (0003_attendance.sql) — same pattern again.
  describe('attendance_records', () => {
    it('Tenant A can see its own attendance record', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, status from attendance_records');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(ATTENDANCE_RECORD_IN_TENANT_A);
    });

    it("Tenant B CANNOT see Tenant A's attendance record by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from attendance_records');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === ATTENDANCE_RECORD_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's attendance record by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from attendance_records where id = $1', [
        ATTENDANCE_RECORD_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's attendance record", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update attendance_records set status = 'absent' where id = $1 returning id`,
        [ATTENDANCE_RECORD_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from attendance_records where id = $1',
        [ATTENDANCE_RECORD_IN_TENANT_A],
      );
      expect(check[0].status).toBe('present');
    });

    it('A session with NO tenant context set sees zero attendance rows', async () => {
      const rows = await queryAsTenant(null, 'select id from attendance_records');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero attendance rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from attendance_records');
      expect(rows).toHaveLength(0);
    });
  });

  // subjects, assessment_structures, assessment_components and scores
  // (0004_assessment.sql) — same pattern again. assessment_components is
  // intentionally not given its own block: it has no direct tenant-facing
  // identity test beyond what subjects/assessment_structures/scores already
  // cover, and the seed data ties every component to a structure this suite
  // already isolation-tests.
  describe('subjects', () => {
    it('Tenant A can see its own subject', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, name, code from subjects');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(SUBJECT_IN_TENANT_A);
      expect(rows[0].code).toBe('MATH');
    });

    it("Tenant B CANNOT see Tenant A's subject by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from subjects');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === SUBJECT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's subject by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from subjects where id = $1', [
        SUBJECT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's subject", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update subjects set name = 'HACKED' where id = $1 returning id`,
        [SUBJECT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ name: string }>(
        TENANT_A,
        'select name from subjects where id = $1',
        [SUBJECT_IN_TENANT_A],
      );
      expect(check[0].name).toBe('Mathematics');
    });

    it('A session with NO tenant context set sees zero subject rows', async () => {
      const rows = await queryAsTenant(null, 'select id from subjects');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero subject rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from subjects');
      expect(rows).toHaveLength(0);
    });
  });

  describe('assessment_structures', () => {
    it('Tenant A can see its own assessment structure', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, status from assessment_structures');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(ASSESSMENT_STRUCTURE_IN_TENANT_A);
      expect(rows[0].status).toBe('draft');
    });

    it("Tenant B CANNOT see Tenant A's assessment structure by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from assessment_structures');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === ASSESSMENT_STRUCTURE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's assessment structure by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from assessment_structures where id = $1', [
        ASSESSMENT_STRUCTURE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's assessment structure", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update assessment_structures set status = 'published' where id = $1 returning id`,
        [ASSESSMENT_STRUCTURE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from assessment_structures where id = $1',
        [ASSESSMENT_STRUCTURE_IN_TENANT_A],
      );
      expect(check[0].status).toBe('draft');
    });

    it('A session with NO tenant context set sees zero assessment structure rows', async () => {
      const rows = await queryAsTenant(null, 'select id from assessment_structures');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero assessment structure rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from assessment_structures',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('scores', () => {
    it('Tenant A can see its own scores', async () => {
      // Two rows per tenant as of 0005_grading.sql's seed additions — one
      // per assessment component (class_exercise, end_of_term_exam), added
      // specifically so grading's compute() has a complete component set
      // to work with (FR-GRA-060 refuses to run against any incomplete one).
      const rows = await queryAsTenant(TENANT_A, 'select id, value, status from scores');
      expect(rows).toHaveLength(2);
      const seeded = rows.find((r) => r.id === SCORE_IN_TENANT_A);
      expect(Number(seeded?.value)).toBe(32);
    });

    it("Tenant B CANNOT see Tenant A's scores by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from scores');
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === SCORE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's score by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from scores where id = $1', [SCORE_IN_TENANT_A]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's score", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update scores set value = 999 where id = $1 returning id`,
        [SCORE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ value: string }>(
        TENANT_A,
        'select value from scores where id = $1',
        [SCORE_IN_TENANT_A],
      );
      expect(Number(check[0].value)).toBe(32);
    });

    it('A session with NO tenant context set sees zero score rows', async () => {
      const rows = await queryAsTenant(null, 'select id from scores');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero score rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from scores');
      expect(rows).toHaveLength(0);
    });
  });

  // grading_policies, grading_scale_items and result_candidates
  // (0005_grading.sql) — same pattern again.
  describe('grading_policies', () => {
    it('Tenant A can see its own grading policy', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, name, status from grading_policies');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(GRADING_POLICY_IN_TENANT_A);
      expect(rows[0].status).toBe('active');
    });

    it("Tenant B CANNOT see Tenant A's grading policy by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from grading_policies');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === GRADING_POLICY_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's grading policy by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from grading_policies where id = $1', [
        GRADING_POLICY_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's grading policy", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update grading_policies set status = 'retired' where id = $1 returning id`,
        [GRADING_POLICY_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from grading_policies where id = $1',
        [GRADING_POLICY_IN_TENANT_A],
      );
      expect(check[0].status).toBe('active');
    });

    it('A session with NO tenant context set sees zero grading policy rows', async () => {
      const rows = await queryAsTenant(null, 'select id from grading_policies');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero grading policy rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from grading_policies');
      expect(rows).toHaveLength(0);
    });
  });

  describe('grading_scale_items', () => {
    it('Tenant A can see its own scale item', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, grade from grading_scale_items');
      expect(rows).toHaveLength(4);
      expect(rows.find((r) => r.id === SCALE_ITEM_IN_TENANT_A)?.grade).toBe('F');
    });

    it("Tenant B CANNOT see Tenant A's scale item by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from grading_scale_items');
      expect(rows).toHaveLength(4);
      expect(rows.find((r) => r.id === SCALE_ITEM_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's scale item by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from grading_scale_items where id = $1', [
        SCALE_ITEM_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's scale item", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update grading_scale_items set grade = 'HACKED' where id = $1 returning id`,
        [SCALE_ITEM_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ grade: string }>(
        TENANT_A,
        'select grade from grading_scale_items where id = $1',
        [SCALE_ITEM_IN_TENANT_A],
      );
      expect(check[0].grade).toBe('F');
    });

    it('A session with NO tenant context set sees zero scale item rows', async () => {
      const rows = await queryAsTenant(null, 'select id from grading_scale_items');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero scale item rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from grading_scale_items');
      expect(rows).toHaveLength(0);
    });
  });

  describe('result_candidates', () => {
    it('Tenant A can see its own result candidate', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, grade, percentage from result_candidates');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(RESULT_CANDIDATE_IN_TENANT_A);
      expect(rows[0].grade).toBe('C');
    });

    it("Tenant B CANNOT see Tenant A's result candidate by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from result_candidates');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === RESULT_CANDIDATE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's result candidate by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from result_candidates where id = $1', [
        RESULT_CANDIDATE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's result candidate", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update result_candidates set grade = 'HACKED' where id = $1 returning id`,
        [RESULT_CANDIDATE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ grade: string }>(
        TENANT_A,
        'select grade from result_candidates where id = $1',
        [RESULT_CANDIDATE_IN_TENANT_A],
      );
      expect(check[0].grade).toBe('C');
    });

    it('A session with NO tenant context set sees zero result candidate rows', async () => {
      const rows = await queryAsTenant(null, 'select id from result_candidates');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero result candidate rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from result_candidates');
      expect(rows).toHaveLength(0);
    });
  });

  // student_results and student_result_items (0006_results.sql) — same
  // pattern again.
  describe('student_results', () => {
    it('Tenant A can see its own student result', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, status, average_percentage from student_results');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(STUDENT_RESULT_IN_TENANT_A);
      expect(rows[0].status).toBe('draft');
    });

    it("Tenant B CANNOT see Tenant A's student result by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from student_results');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === STUDENT_RESULT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's student result by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from student_results where id = $1', [
        STUDENT_RESULT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's student result", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update student_results set status = 'published' where id = $1 returning id`,
        [STUDENT_RESULT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from student_results where id = $1',
        [STUDENT_RESULT_IN_TENANT_A],
      );
      expect(check[0].status).toBe('draft');
    });

    it('A session with NO tenant context set sees zero student result rows', async () => {
      const rows = await queryAsTenant(null, 'select id from student_results');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero student result rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from student_results');
      expect(rows).toHaveLength(0);
    });
  });

  describe('student_result_items', () => {
    it('Tenant A can see its own student result item', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, subject_name, grade from student_result_items');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(STUDENT_RESULT_ITEM_IN_TENANT_A);
      expect(rows[0].grade).toBe('C');
    });

    it("Tenant B CANNOT see Tenant A's student result item by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from student_result_items');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === STUDENT_RESULT_ITEM_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's student result item by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from student_result_items where id = $1', [
        STUDENT_RESULT_ITEM_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's student result item", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update student_result_items set grade = 'HACKED' where id = $1 returning id`,
        [STUDENT_RESULT_ITEM_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ grade: string }>(
        TENANT_A,
        'select grade from student_result_items where id = $1',
        [STUDENT_RESULT_ITEM_IN_TENANT_A],
      );
      expect(check[0].grade).toBe('C');
    });

    it('A session with NO tenant context set sees zero student result item rows', async () => {
      const rows = await queryAsTenant(null, 'select id from student_result_items');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero student result item rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from student_result_items',
      );
      expect(rows).toHaveLength(0);
    });
  });

  // tenant_branding, promotion_decisions and generated_documents
  // (0007_promotion_documents.sql) — same pattern again.
  describe('tenant_branding', () => {
    it('Tenant A can see its own branding', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, signatory_name from tenant_branding');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(TENANT_BRANDING_IN_TENANT_A);
      expect(rows[0].signatory_name).toBe('Kwame Asante');
    });

    it("Tenant B CANNOT see Tenant A's branding by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from tenant_branding');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === TENANT_BRANDING_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's branding by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from tenant_branding where id = $1', [
        TENANT_BRANDING_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's branding", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update tenant_branding set signatory_name = 'HACKED' where id = $1 returning id`,
        [TENANT_BRANDING_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ signatory_name: string }>(
        TENANT_A,
        'select signatory_name from tenant_branding where id = $1',
        [TENANT_BRANDING_IN_TENANT_A],
      );
      expect(check[0].signatory_name).toBe('Kwame Asante');
    });

    it('A session with NO tenant context set sees zero branding rows', async () => {
      const rows = await queryAsTenant(null, 'select id from tenant_branding');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero branding rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from tenant_branding');
      expect(rows).toHaveLength(0);
    });
  });

  describe('promotion_decisions', () => {
    it('Tenant A can see its own promotion decision', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, system_recommendation from promotion_decisions');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(PROMOTION_DECISION_IN_TENANT_A);
      expect(rows[0].system_recommendation).toBe('promote');
    });

    it("Tenant B CANNOT see Tenant A's promotion decision by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from promotion_decisions');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === PROMOTION_DECISION_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's promotion decision by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from promotion_decisions where id = $1', [
        PROMOTION_DECISION_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's promotion decision", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update promotion_decisions set status = 'applied' where id = $1 returning id`,
        [PROMOTION_DECISION_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from promotion_decisions where id = $1',
        [PROMOTION_DECISION_IN_TENANT_A],
      );
      expect(check[0].status).toBe('recommended');
    });

    it('A session with NO tenant context set sees zero promotion decision rows', async () => {
      const rows = await queryAsTenant(null, 'select id from promotion_decisions');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero promotion decision rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from promotion_decisions',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('generated_documents', () => {
    it('Tenant A can see its own generated document', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, reference_number from generated_documents');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(GENERATED_DOCUMENT_IN_TENANT_A);
      expect(rows[0].reference_number).toBe('RC-000001');
    });

    it("Tenant B CANNOT see Tenant A's generated document by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from generated_documents');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === GENERATED_DOCUMENT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's generated document by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from generated_documents where id = $1', [
        GENERATED_DOCUMENT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's generated document", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update generated_documents set reference_number = 'HACKED' where id = $1 returning id`,
        [GENERATED_DOCUMENT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ reference_number: string }>(
        TENANT_A,
        'select reference_number from generated_documents where id = $1',
        [GENERATED_DOCUMENT_IN_TENANT_A],
      );
      expect(check[0].reference_number).toBe('RC-000001');
    });

    it('A session with NO tenant context set sees zero generated document rows', async () => {
      const rows = await queryAsTenant(null, 'select id from generated_documents');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero generated document rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from generated_documents',
      );
      expect(rows).toHaveLength(0);
    });
  });

  // fee_structures, fee_structure_items, fee_instalments, invoices,
  // invoice_items, payments and payment_allocations (0008_finance.sql) —
  // same pattern again.
  describe('fee_structures', () => {
    it('Tenant A can see its own fee structure', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, name, status from fee_structures');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(FEE_STRUCTURE_IN_TENANT_A);
      expect(rows[0].status).toBe('active');
    });

    it("Tenant B CANNOT see Tenant A's fee structure by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from fee_structures');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === FEE_STRUCTURE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's fee structure by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from fee_structures where id = $1', [
        FEE_STRUCTURE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's fee structure", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update fee_structures set status = 'draft' where id = $1 returning id`,
        [FEE_STRUCTURE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from fee_structures where id = $1',
        [FEE_STRUCTURE_IN_TENANT_A],
      );
      expect(check[0].status).toBe('active');
    });

    it('A session with NO tenant context set sees zero fee structure rows', async () => {
      const rows = await queryAsTenant(null, 'select id from fee_structures');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero fee structure rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from fee_structures');
      expect(rows).toHaveLength(0);
    });
  });

  describe('fee_structure_items', () => {
    it('Tenant A can see its own fee structure item', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, name, amount from fee_structure_items');
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === FEE_STRUCTURE_ITEM_IN_TENANT_A)?.name).toBe('Tuition');
    });

    it("Tenant B CANNOT see Tenant A's fee structure item by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from fee_structure_items');
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === FEE_STRUCTURE_ITEM_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's fee structure item by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from fee_structure_items where id = $1', [
        FEE_STRUCTURE_ITEM_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's fee structure item", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update fee_structure_items set amount = 999999 where id = $1 returning id`,
        [FEE_STRUCTURE_ITEM_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ amount: string }>(
        TENANT_A,
        'select amount from fee_structure_items where id = $1',
        [FEE_STRUCTURE_ITEM_IN_TENANT_A],
      );
      expect(Number(check[0].amount)).toBe(800);
    });

    it('A session with NO tenant context set sees zero fee structure item rows', async () => {
      const rows = await queryAsTenant(null, 'select id from fee_structure_items');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero fee structure item rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from fee_structure_items',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('fee_instalments', () => {
    it('Tenant A can see its own instalment', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, sequence, amount from fee_instalments');
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === FEE_INSTALMENT_IN_TENANT_A)?.sequence).toBe(1);
    });

    it("Tenant B CANNOT see Tenant A's instalment by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from fee_instalments');
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === FEE_INSTALMENT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's instalment by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from fee_instalments where id = $1', [
        FEE_INSTALMENT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's instalment", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update fee_instalments set amount = 999999 where id = $1 returning id`,
        [FEE_INSTALMENT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ amount: string }>(
        TENANT_A,
        'select amount from fee_instalments where id = $1',
        [FEE_INSTALMENT_IN_TENANT_A],
      );
      expect(Number(check[0].amount)).toBe(500);
    });

    it('A session with NO tenant context set sees zero instalment rows', async () => {
      const rows = await queryAsTenant(null, 'select id from fee_instalments');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero instalment rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from fee_instalments');
      expect(rows).toHaveLength(0);
    });
  });

  describe('invoices', () => {
    it('Tenant A can see its own invoice', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, invoice_number, total_amount from invoices');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(INVOICE_IN_TENANT_A);
      expect(Number(rows[0].total_amount)).toBe(1000);
    });

    it("Tenant B CANNOT see Tenant A's invoice by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from invoices');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === INVOICE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's invoice by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from invoices where id = $1', [INVOICE_IN_TENANT_A]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's invoice", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update invoices set status = 'cancelled' where id = $1 returning id`,
        [INVOICE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(TENANT_A, 'select status from invoices where id = $1', [
        INVOICE_IN_TENANT_A,
      ]);
      expect(check[0].status).toBe('posted');
    });

    it('A session with NO tenant context set sees zero invoice rows', async () => {
      const rows = await queryAsTenant(null, 'select id from invoices');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero invoice rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from invoices');
      expect(rows).toHaveLength(0);
    });
  });

  describe('invoice_items', () => {
    it('Tenant A can see its own invoice item', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, description, amount from invoice_items');
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === INVOICE_ITEM_IN_TENANT_A)?.description).toBe('Tuition');
    });

    it("Tenant B CANNOT see Tenant A's invoice item by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from invoice_items');
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === INVOICE_ITEM_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's invoice item by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from invoice_items where id = $1', [
        INVOICE_ITEM_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's invoice item", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update invoice_items set amount = 999999 where id = $1 returning id`,
        [INVOICE_ITEM_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ amount: string }>(
        TENANT_A,
        'select amount from invoice_items where id = $1',
        [INVOICE_ITEM_IN_TENANT_A],
      );
      expect(Number(check[0].amount)).toBe(800);
    });

    it('A session with NO tenant context set sees zero invoice item rows', async () => {
      const rows = await queryAsTenant(null, 'select id from invoice_items');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero invoice item rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from invoice_items');
      expect(rows).toHaveLength(0);
    });
  });

  describe('fee_penalty_rules', () => {
    it('Tenant A can see its own penalty rule', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, name, frequency from fee_penalty_rules');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(FEE_PENALTY_RULE_IN_TENANT_A);
      expect(rows[0].frequency).toBe('weekly');
    });

    it("Tenant B CANNOT see Tenant A's penalty rule by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from fee_penalty_rules');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === FEE_PENALTY_RULE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's penalty rule by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from fee_penalty_rules where id = $1', [
        FEE_PENALTY_RULE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's penalty rule", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update fee_penalty_rules set status = 'inactive' where id = $1 returning id`,
        [FEE_PENALTY_RULE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from fee_penalty_rules where id = $1',
        [FEE_PENALTY_RULE_IN_TENANT_A],
      );
      expect(check[0].status).toBe('active');
    });

    it('A session with NO tenant context set sees zero penalty rule rows', async () => {
      const rows = await queryAsTenant(null, 'select id from fee_penalty_rules');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero penalty rule rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from fee_penalty_rules');
      expect(rows).toHaveLength(0);
    });
  });

  describe('fee_penalty_charges', () => {
    it('Tenant A can see its own penalty charge', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, amount from fee_penalty_charges');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(FEE_PENALTY_CHARGE_IN_TENANT_A);
      expect(Number(rows[0].amount)).toBe(50);
    });

    it("Tenant B CANNOT see Tenant A's penalty charge by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from fee_penalty_charges');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === FEE_PENALTY_CHARGE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's penalty charge by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from fee_penalty_charges where id = $1', [
        FEE_PENALTY_CHARGE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's penalty charge", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update fee_penalty_charges set amount = 999999 where id = $1 returning id`,
        [FEE_PENALTY_CHARGE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ amount: string }>(
        TENANT_A,
        'select amount from fee_penalty_charges where id = $1',
        [FEE_PENALTY_CHARGE_IN_TENANT_A],
      );
      expect(Number(check[0].amount)).toBe(50);
    });

    it('A session with NO tenant context set sees zero penalty charge rows', async () => {
      const rows = await queryAsTenant(null, 'select id from fee_penalty_charges');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero penalty charge rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from fee_penalty_charges',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('payments', () => {
    it('Tenant A can see its own payments', async () => {
      // Two rows per tenant as of 0009_finance_assistance.sql's seed
      // additions — the original 600 GHS payment plus a small throwaway
      // one that exists purely as the reversals block's fixture.
      const rows = await queryAsTenant(TENANT_A, 'select id, method, amount from payments');
      expect(rows).toHaveLength(2);
      const seeded = rows.find((r) => r.id === PAYMENT_IN_TENANT_A);
      expect(Number(seeded?.amount)).toBe(600);
    });

    it("Tenant B CANNOT see Tenant A's payments by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from payments');
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === PAYMENT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's payment by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from payments where id = $1', [PAYMENT_IN_TENANT_A]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's payment", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update payments set amount = 999999 where id = $1 returning id`,
        [PAYMENT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ amount: string }>(TENANT_A, 'select amount from payments where id = $1', [
        PAYMENT_IN_TENANT_A,
      ]);
      expect(Number(check[0].amount)).toBe(600);
    });

    it('A session with NO tenant context set sees zero payment rows', async () => {
      const rows = await queryAsTenant(null, 'select id from payments');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero payment rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from payments');
      expect(rows).toHaveLength(0);
    });
  });

  describe('payment_allocations', () => {
    it('Tenant A can see its own allocation', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, amount from payment_allocations');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(PAYMENT_ALLOCATION_IN_TENANT_A);
      expect(Number(rows[0].amount)).toBe(600);
    });

    it("Tenant B CANNOT see Tenant A's allocation by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from payment_allocations');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === PAYMENT_ALLOCATION_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's allocation by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from payment_allocations where id = $1', [
        PAYMENT_ALLOCATION_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's allocation", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update payment_allocations set amount = 999999 where id = $1 returning id`,
        [PAYMENT_ALLOCATION_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ amount: string }>(
        TENANT_A,
        'select amount from payment_allocations where id = $1',
        [PAYMENT_ALLOCATION_IN_TENANT_A],
      );
      expect(Number(check[0].amount)).toBe(600);
    });

    it('A session with NO tenant context set sees zero allocation rows', async () => {
      const rows = await queryAsTenant(null, 'select id from payment_allocations');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero allocation rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from payment_allocations',
      );
      expect(rows).toHaveLength(0);
    });
  });

  // financial_assistance and reversals (0009_finance_assistance.sql) —
  // same pattern again.
  describe('financial_assistance', () => {
    it('Tenant A can see its own assistance request', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, type, status from financial_assistance');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(FINANCIAL_ASSISTANCE_IN_TENANT_A);
      expect(rows[0].status).toBe('approved');
    });

    it("Tenant B CANNOT see Tenant A's assistance request by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from financial_assistance');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === FINANCIAL_ASSISTANCE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's assistance request by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from financial_assistance where id = $1', [
        FINANCIAL_ASSISTANCE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's assistance request", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update financial_assistance set status = 'rejected' where id = $1 returning id`,
        [FINANCIAL_ASSISTANCE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from financial_assistance where id = $1',
        [FINANCIAL_ASSISTANCE_IN_TENANT_A],
      );
      expect(check[0].status).toBe('approved');
    });

    it('A session with NO tenant context set sees zero assistance rows', async () => {
      const rows = await queryAsTenant(null, 'select id from financial_assistance');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero assistance rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from financial_assistance',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('reversals', () => {
    it('Tenant A can see its own reversal', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, reversed_entity_type from reversals');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(REVERSAL_IN_TENANT_A);
      expect(rows[0].reversed_entity_type).toBe('payment');
    });

    it("Tenant B CANNOT see Tenant A's reversal by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from reversals');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === REVERSAL_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's reversal by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from reversals where id = $1', [REVERSAL_IN_TENANT_A]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's reversal", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update reversals set reason = 'HACKED' where id = $1 returning id`,
        [REVERSAL_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ reason: string }>(TENANT_A, 'select reason from reversals where id = $1', [
        REVERSAL_IN_TENANT_A,
      ]);
      expect(check[0].reason).toBe('Recorded in error - duplicate entry');
    });

    it('A session with NO tenant context set sees zero reversal rows', async () => {
      const rows = await queryAsTenant(null, 'select id from reversals');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero reversal rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from reversals');
      expect(rows).toHaveLength(0);
    });
  });

  describe('notification_templates', () => {
    it('Tenant A can see its own notification template', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, code from notification_templates');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(NOTIFICATION_TEMPLATE_IN_TENANT_A);
      expect(rows[0].code).toBe('attendance_alert');
    });

    it("Tenant B CANNOT see Tenant A's notification template by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from notification_templates');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === NOTIFICATION_TEMPLATE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's notification template by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from notification_templates where id = $1', [
        NOTIFICATION_TEMPLATE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's notification template", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update notification_templates set body = 'HACKED' where id = $1 returning id`,
        [NOTIFICATION_TEMPLATE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ body: string }>(
        TENANT_A,
        'select body from notification_templates where id = $1',
        [NOTIFICATION_TEMPLATE_IN_TENANT_A],
      );
      expect(check[0].body).toContain('{{recipientName}}');
    });

    it('A session with NO tenant context set sees zero notification template rows', async () => {
      const rows = await queryAsTenant(null, 'select id from notification_templates');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero notification template rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from notification_templates',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('communication_preferences', () => {
    it('Tenant A can see its own communication preference', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, opted_in from communication_preferences');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(COMMUNICATION_PREFERENCE_IN_TENANT_A);
      expect(rows[0].opted_in).toBe(false);
    });

    it("Tenant B CANNOT see Tenant A's communication preference by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from communication_preferences');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === COMMUNICATION_PREFERENCE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's communication preference by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from communication_preferences where id = $1', [
        COMMUNICATION_PREFERENCE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's communication preference", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update communication_preferences set opted_in = true where id = $1 returning id`,
        [COMMUNICATION_PREFERENCE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ opted_in: boolean }>(
        TENANT_A,
        'select opted_in from communication_preferences where id = $1',
        [COMMUNICATION_PREFERENCE_IN_TENANT_A],
      );
      expect(check[0].opted_in).toBe(false);
    });

    it('A session with NO tenant context set sees zero communication preference rows', async () => {
      const rows = await queryAsTenant(null, 'select id from communication_preferences');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero communication preference rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from communication_preferences',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('notifications', () => {
    it('Tenant A can see its own notification', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, status from notifications');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(NOTIFICATION_IN_TENANT_A);
      expect(rows[0].status).toBe('queued');
    });

    it("Tenant B CANNOT see Tenant A's notification by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from notifications');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === NOTIFICATION_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's notification by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from notifications where id = $1', [
        NOTIFICATION_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's notification", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update notifications set status = 'delivered' where id = $1 returning id`,
        [NOTIFICATION_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from notifications where id = $1',
        [NOTIFICATION_IN_TENANT_A],
      );
      expect(check[0].status).toBe('queued');
    });

    it('A session with NO tenant context set sees zero notification rows', async () => {
      const rows = await queryAsTenant(null, 'select id from notifications');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero notification rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from notifications');
      expect(rows).toHaveLength(0);
    });
  });

  describe('notification_deliveries', () => {
    it('Tenant A can see its own notification delivery', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, status from notification_deliveries');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(NOTIFICATION_DELIVERY_IN_TENANT_A);
      expect(rows[0].status).toBe('rejected_not_implemented');
    });

    it("Tenant B CANNOT see Tenant A's notification delivery by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from notification_deliveries');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === NOTIFICATION_DELIVERY_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's notification delivery by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from notification_deliveries where id = $1', [
        NOTIFICATION_DELIVERY_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's notification delivery", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update notification_deliveries set status = 'sent' where id = $1 returning id`,
        [NOTIFICATION_DELIVERY_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from notification_deliveries where id = $1',
        [NOTIFICATION_DELIVERY_IN_TENANT_A],
      );
      expect(check[0].status).toBe('rejected_not_implemented');
    });

    it('A session with NO tenant context set sees zero notification delivery rows', async () => {
      const rows = await queryAsTenant(null, 'select id from notification_deliveries');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero notification delivery rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from notification_deliveries',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('tenant_communication_settings', () => {
    it('Tenant A can see its own communication settings', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, monthly_sms_cost_threshold from tenant_communication_settings');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(TENANT_COMMUNICATION_SETTINGS_IN_TENANT_A);
      expect(Number(rows[0].monthly_sms_cost_threshold)).toBe(200);
    });

    it("Tenant B CANNOT see Tenant A's communication settings by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from tenant_communication_settings');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === TENANT_COMMUNICATION_SETTINGS_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's communication settings by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from tenant_communication_settings where id = $1', [
        TENANT_COMMUNICATION_SETTINGS_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's communication settings", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update tenant_communication_settings set monthly_sms_cost_threshold = 999999 where id = $1 returning id`,
        [TENANT_COMMUNICATION_SETTINGS_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ monthly_sms_cost_threshold: string }>(
        TENANT_A,
        'select monthly_sms_cost_threshold from tenant_communication_settings where id = $1',
        [TENANT_COMMUNICATION_SETTINGS_IN_TENANT_A],
      );
      expect(Number(check[0].monthly_sms_cost_threshold)).toBe(200);
    });

    it('A session with NO tenant context set sees zero communication settings rows', async () => {
      const rows = await queryAsTenant(null, 'select id from tenant_communication_settings');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero communication settings rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from tenant_communication_settings',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('notification_reports', () => {
    it('Tenant A can see its own notification report', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, status from notification_reports');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(NOTIFICATION_REPORT_IN_TENANT_A);
      expect(rows[0].status).toBe('open');
    });

    it("Tenant B CANNOT see Tenant A's notification report by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from notification_reports');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === NOTIFICATION_REPORT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's notification report by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from notification_reports where id = $1', [
        NOTIFICATION_REPORT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's notification report", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update notification_reports set status = 'completed' where id = $1 returning id`,
        [NOTIFICATION_REPORT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from notification_reports where id = $1',
        [NOTIFICATION_REPORT_IN_TENANT_A],
      );
      expect(check[0].status).toBe('open');
    });

    it('A session with NO tenant context set sees zero notification report rows', async () => {
      const rows = await queryAsTenant(null, 'select id from notification_reports');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero notification report rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from notification_reports',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('notification_report_comments', () => {
    it('Tenant A can see its own notification report comment', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, comment from notification_report_comments');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(NOTIFICATION_REPORT_COMMENT_IN_TENANT_A);
    });

    it("Tenant B CANNOT see Tenant A's notification report comment by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from notification_report_comments');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === NOTIFICATION_REPORT_COMMENT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's notification report comment by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from notification_report_comments where id = $1', [
        NOTIFICATION_REPORT_COMMENT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's notification report comment", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update notification_report_comments set comment = 'HACKED' where id = $1 returning id`,
        [NOTIFICATION_REPORT_COMMENT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ comment: string }>(
        TENANT_A,
        'select comment from notification_report_comments where id = $1',
        [NOTIFICATION_REPORT_COMMENT_IN_TENANT_A],
      );
      expect(check[0].comment).toContain('Called the guardian');
    });

    it('A session with NO tenant context set sees zero notification report comment rows', async () => {
      const rows = await queryAsTenant(null, 'select id from notification_report_comments');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero notification report comment rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from notification_report_comments',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('discipline_cases', () => {
    it('Tenant A can see its own discipline case', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, category from discipline_cases');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(DISCIPLINE_CASE_IN_TENANT_A);
      expect(rows[0].category).toBe('fighting');
    });

    it("Tenant B CANNOT see Tenant A's discipline case by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from discipline_cases');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === DISCIPLINE_CASE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's discipline case by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from discipline_cases where id = $1', [
        DISCIPLINE_CASE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's discipline case", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update discipline_cases set category = 'HACKED' where id = $1 returning id`,
        [DISCIPLINE_CASE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ category: string }>(
        TENANT_A,
        'select category from discipline_cases where id = $1',
        [DISCIPLINE_CASE_IN_TENANT_A],
      );
      expect(check[0].category).toBe('fighting');
    });

    it('A session with NO tenant context set sees zero discipline case rows', async () => {
      const rows = await queryAsTenant(null, 'select id from discipline_cases');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero discipline case rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from discipline_cases');
      expect(rows).toHaveLength(0);
    });
  });

  describe('discipline_case_notes', () => {
    it('Tenant A can see its own discipline case note', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, note from discipline_case_notes');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(DISCIPLINE_CASE_NOTE_IN_TENANT_A);
    });

    it("Tenant B CANNOT see Tenant A's discipline case note by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from discipline_case_notes');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === DISCIPLINE_CASE_NOTE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's discipline case note by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from discipline_case_notes where id = $1', [
        DISCIPLINE_CASE_NOTE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's discipline case note", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update discipline_case_notes set note = 'HACKED' where id = $1 returning id`,
        [DISCIPLINE_CASE_NOTE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ note: string }>(
        TENANT_A,
        'select note from discipline_case_notes where id = $1',
        [DISCIPLINE_CASE_NOTE_IN_TENANT_A],
      );
      expect(check[0].note).toContain('Spoke with both students');
    });

    it('A session with NO tenant context set sees zero discipline case note rows', async () => {
      const rows = await queryAsTenant(null, 'select id from discipline_case_notes');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero discipline case note rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from discipline_case_notes',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('discipline_case_responses', () => {
    it('Tenant A can see its own discipline case response', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, response_type from discipline_case_responses');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(DISCIPLINE_CASE_RESPONSE_IN_TENANT_A);
      expect(rows[0].response_type).toBe('detention');
    });

    it("Tenant B CANNOT see Tenant A's discipline case response by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from discipline_case_responses');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === DISCIPLINE_CASE_RESPONSE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's discipline case response by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from discipline_case_responses where id = $1', [
        DISCIPLINE_CASE_RESPONSE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's discipline case response", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update discipline_case_responses set description = 'HACKED' where id = $1 returning id`,
        [DISCIPLINE_CASE_RESPONSE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ description: string }>(
        TENANT_A,
        'select description from discipline_case_responses where id = $1',
        [DISCIPLINE_CASE_RESPONSE_IN_TENANT_A],
      );
      expect(check[0].description).toContain('detention');
    });

    it('A session with NO tenant context set sees zero discipline case response rows', async () => {
      const rows = await queryAsTenant(null, 'select id from discipline_case_responses');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero discipline case response rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from discipline_case_responses',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('discipline_guardian_contacts', () => {
    it('Tenant A can see its own discipline guardian contact', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, channel from discipline_guardian_contacts');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(DISCIPLINE_GUARDIAN_CONTACT_IN_TENANT_A);
      expect(rows[0].channel).toBe('phone_call');
    });

    it("Tenant B CANNOT see Tenant A's discipline guardian contact by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from discipline_guardian_contacts');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === DISCIPLINE_GUARDIAN_CONTACT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's discipline guardian contact by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from discipline_guardian_contacts where id = $1', [
        DISCIPLINE_GUARDIAN_CONTACT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's discipline guardian contact", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update discipline_guardian_contacts set notes = 'HACKED' where id = $1 returning id`,
        [DISCIPLINE_GUARDIAN_CONTACT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ notes: string }>(
        TENANT_A,
        'select notes from discipline_guardian_contacts where id = $1',
        [DISCIPLINE_GUARDIAN_CONTACT_IN_TENANT_A],
      );
      expect(check[0].notes).toContain('Called guardian');
    });

    it('A session with NO tenant context set sees zero discipline guardian contact rows', async () => {
      const rows = await queryAsTenant(null, 'select id from discipline_guardian_contacts');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero discipline guardian contact rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from discipline_guardian_contacts',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('discipline_appeals', () => {
    it('Tenant A can see its own discipline appeal', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, decision from discipline_appeals');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(DISCIPLINE_APPEAL_IN_TENANT_A);
      expect(rows[0].decision).toBe('pending');
    });

    it("Tenant B CANNOT see Tenant A's discipline appeal by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from discipline_appeals');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === DISCIPLINE_APPEAL_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's discipline appeal by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from discipline_appeals where id = $1', [
        DISCIPLINE_APPEAL_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's discipline appeal", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update discipline_appeals set reason = 'HACKED' where id = $1 returning id`,
        [DISCIPLINE_APPEAL_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ reason: string }>(
        TENANT_A,
        'select reason from discipline_appeals where id = $1',
        [DISCIPLINE_APPEAL_IN_TENANT_A],
      );
      expect(check[0].reason).toContain('disputes');
    });

    it('A session with NO tenant context set sees zero discipline appeal rows', async () => {
      const rows = await queryAsTenant(null, 'select id from discipline_appeals');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero discipline appeal rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from discipline_appeals');
      expect(rows).toHaveLength(0);
    });
  });

  describe('discipline_recognitions', () => {
    it('Tenant A can see its own discipline recognition', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, category from discipline_recognitions');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(DISCIPLINE_RECOGNITION_IN_TENANT_A);
      expect(rows[0].category).toBe('academic_excellence');
    });

    it("Tenant B CANNOT see Tenant A's discipline recognition by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from discipline_recognitions');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === DISCIPLINE_RECOGNITION_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's discipline recognition by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from discipline_recognitions where id = $1', [
        DISCIPLINE_RECOGNITION_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's discipline recognition", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update discipline_recognitions set description = 'HACKED' where id = $1 returning id`,
        [DISCIPLINE_RECOGNITION_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ description: string }>(
        TENANT_A,
        'select description from discipline_recognitions where id = $1',
        [DISCIPLINE_RECOGNITION_IN_TENANT_A],
      );
      expect(check[0].description).toContain('Top of class');
    });

    it('A session with NO tenant context set sees zero discipline recognition rows', async () => {
      const rows = await queryAsTenant(null, 'select id from discipline_recognitions');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero discipline recognition rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from discipline_recognitions',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('library_items', () => {
    it('Tenant A can see its own library item', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, title from library_items');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(LIBRARY_ITEM_IN_TENANT_A);
      expect(rows[0].title).toBe('Basic English Grammar');
    });

    it("Tenant B CANNOT see Tenant A's library item by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from library_items');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === LIBRARY_ITEM_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's library item by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from library_items where id = $1', [
        LIBRARY_ITEM_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's library item", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update library_items set title = 'HACKED' where id = $1 returning id`,
        [LIBRARY_ITEM_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ title: string }>(TENANT_A, 'select title from library_items where id = $1', [
        LIBRARY_ITEM_IN_TENANT_A,
      ]);
      expect(check[0].title).toBe('Basic English Grammar');
    });

    it('A session with NO tenant context set sees zero library item rows', async () => {
      const rows = await queryAsTenant(null, 'select id from library_items');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero library item rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from library_items');
      expect(rows).toHaveLength(0);
    });
  });

  describe('library_members', () => {
    it('Tenant A can see its own library member', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, student_id from library_members');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(LIBRARY_MEMBER_IN_TENANT_A);
    });

    it("Tenant B CANNOT see Tenant A's library member by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from library_members');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === LIBRARY_MEMBER_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's library member by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from library_members where id = $1', [
        LIBRARY_MEMBER_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's library member", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update library_members set staff_user_id = staff_user_id where id = $1 returning id`,
        [LIBRARY_MEMBER_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });

    it('A session with NO tenant context set sees zero library member rows', async () => {
      const rows = await queryAsTenant(null, 'select id from library_members');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero library member rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from library_members');
      expect(rows).toHaveLength(0);
    });
  });

  describe('library_loans', () => {
    it('Tenant A can see its own library loan', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, status from library_loans');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(LIBRARY_LOAN_IN_TENANT_A);
      expect(rows[0].status).toBe('on_loan');
    });

    it("Tenant B CANNOT see Tenant A's library loan by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from library_loans');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === LIBRARY_LOAN_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's library loan by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from library_loans where id = $1', [
        LIBRARY_LOAN_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's library loan", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update library_loans set status = 'returned' where id = $1 returning id`,
        [LIBRARY_LOAN_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(TENANT_A, 'select status from library_loans where id = $1', [
        LIBRARY_LOAN_IN_TENANT_A,
      ]);
      expect(check[0].status).toBe('on_loan');
    });

    it('A session with NO tenant context set sees zero library loan rows', async () => {
      const rows = await queryAsTenant(null, 'select id from library_loans');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero library loan rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from library_loans');
      expect(rows).toHaveLength(0);
    });
  });

  describe('transport_routes', () => {
    it('Tenant A can see its own transport route', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, name from transport_routes');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(TRANSPORT_ROUTE_IN_TENANT_A);
      expect(rows[0].name).toBe('Achimota - Sunrise Basic');
    });

    it("Tenant B CANNOT see Tenant A's transport route by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from transport_routes');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === TRANSPORT_ROUTE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's transport route by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from transport_routes where id = $1', [
        TRANSPORT_ROUTE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's transport route", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update transport_routes set name = 'HACKED' where id = $1 returning id`,
        [TRANSPORT_ROUTE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ name: string }>(TENANT_A, 'select name from transport_routes where id = $1', [
        TRANSPORT_ROUTE_IN_TENANT_A,
      ]);
      expect(check[0].name).toBe('Achimota - Sunrise Basic');
    });

    it('A session with NO tenant context set sees zero transport route rows', async () => {
      const rows = await queryAsTenant(null, 'select id from transport_routes');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero transport route rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from transport_routes');
      expect(rows).toHaveLength(0);
    });
  });

  describe('transport_stops', () => {
    it('Tenant A can see its own transport stop', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, name from transport_stops');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(TRANSPORT_STOP_IN_TENANT_A);
    });

    it("Tenant B CANNOT see Tenant A's transport stop by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from transport_stops');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === TRANSPORT_STOP_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's transport stop by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from transport_stops where id = $1', [
        TRANSPORT_STOP_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's transport stop", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update transport_stops set name = 'HACKED' where id = $1 returning id`,
        [TRANSPORT_STOP_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });

    it('A session with NO tenant context set sees zero transport stop rows', async () => {
      const rows = await queryAsTenant(null, 'select id from transport_stops');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero transport stop rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from transport_stops');
      expect(rows).toHaveLength(0);
    });
  });

  describe('transport_vehicles', () => {
    it('Tenant A can see its own transport vehicle', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, registration_no from transport_vehicles');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(TRANSPORT_VEHICLE_IN_TENANT_A);
      expect(rows[0].registration_no).toBe('GT-1234-20');
    });

    it("Tenant B CANNOT see Tenant A's transport vehicle by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from transport_vehicles');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === TRANSPORT_VEHICLE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's transport vehicle by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from transport_vehicles where id = $1', [
        TRANSPORT_VEHICLE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's transport vehicle", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update transport_vehicles set capacity = 999 where id = $1 returning id`,
        [TRANSPORT_VEHICLE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });

    it('A session with NO tenant context set sees zero transport vehicle rows', async () => {
      const rows = await queryAsTenant(null, 'select id from transport_vehicles');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero transport vehicle rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from transport_vehicles');
      expect(rows).toHaveLength(0);
    });
  });

  describe('transport_drivers', () => {
    it('Tenant A can see its own transport driver', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, license_no from transport_drivers');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(TRANSPORT_DRIVER_IN_TENANT_A);
      expect(rows[0].license_no).toBe('DVLA-000111');
    });

    it("Tenant B CANNOT see Tenant A's transport driver by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from transport_drivers');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === TRANSPORT_DRIVER_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's transport driver by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from transport_drivers where id = $1', [
        TRANSPORT_DRIVER_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's transport driver", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update transport_drivers set name = 'HACKED' where id = $1 returning id`,
        [TRANSPORT_DRIVER_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });

    it('A session with NO tenant context set sees zero transport driver rows', async () => {
      const rows = await queryAsTenant(null, 'select id from transport_drivers');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero transport driver rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from transport_drivers');
      expect(rows).toHaveLength(0);
    });
  });

  describe('transport_student_assignments', () => {
    it('Tenant A can see its own transport student assignment', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, status from transport_student_assignments');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(TRANSPORT_ASSIGNMENT_IN_TENANT_A);
      expect(rows[0].status).toBe('active');
    });

    it("Tenant B CANNOT see Tenant A's transport student assignment by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from transport_student_assignments');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === TRANSPORT_ASSIGNMENT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's transport student assignment by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from transport_student_assignments where id = $1', [
        TRANSPORT_ASSIGNMENT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's transport student assignment", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update transport_student_assignments set status = 'ended' where id = $1 returning id`,
        [TRANSPORT_ASSIGNMENT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from transport_student_assignments where id = $1',
        [TRANSPORT_ASSIGNMENT_IN_TENANT_A],
      );
      expect(check[0].status).toBe('active');
    });

    it('A session with NO tenant context set sees zero transport student assignment rows', async () => {
      const rows = await queryAsTenant(null, 'select id from transport_student_assignments');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero transport student assignment rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from transport_student_assignments',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('health_records', () => {
    it('Tenant A can see its own health record', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, blood_group from health_records');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(HEALTH_RECORD_IN_TENANT_A);
      expect(rows[0].blood_group).toBe('O+');
    });

    it("Tenant B CANNOT see Tenant A's health record by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from health_records');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === HEALTH_RECORD_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's health record by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from health_records where id = $1', [
        HEALTH_RECORD_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's health record", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update health_records set allergies = 'HACKED' where id = $1 returning id`,
        [HEALTH_RECORD_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ allergies: string }>(
        TENANT_A,
        'select allergies from health_records where id = $1',
        [HEALTH_RECORD_IN_TENANT_A],
      );
      expect(check[0].allergies).toBe('Peanuts');
    });

    it('A session with NO tenant context set sees zero health record rows', async () => {
      const rows = await queryAsTenant(null, 'select id from health_records');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero health record rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from health_records');
      expect(rows).toHaveLength(0);
    });
  });

  describe('health_incidents', () => {
    it('Tenant A can see its own health incident', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, severity from health_incidents');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(HEALTH_INCIDENT_IN_TENANT_A);
      expect(rows[0].severity).toBe('moderate');
    });

    it("Tenant B CANNOT see Tenant A's health incident by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from health_incidents');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === HEALTH_INCIDENT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's health incident by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from health_incidents where id = $1', [
        HEALTH_INCIDENT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's health incident", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update health_incidents set status = 'resolved' where id = $1 returning id`,
        [HEALTH_INCIDENT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from health_incidents where id = $1',
        [HEALTH_INCIDENT_IN_TENANT_A],
      );
      expect(check[0].status).toBe('reported');
    });

    it('A session with NO tenant context set sees zero health incident rows', async () => {
      const rows = await queryAsTenant(null, 'select id from health_incidents');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero health incident rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from health_incidents');
      expect(rows).toHaveLength(0);
    });
  });

  describe('health_incident_guardian_contacts', () => {
    it('Tenant A can see its own health incident guardian contact', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, channel from health_incident_guardian_contacts');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(HEALTH_GUARDIAN_CONTACT_IN_TENANT_A);
      expect(rows[0].channel).toBe('phone_call');
    });

    it("Tenant B CANNOT see Tenant A's health incident guardian contact by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from health_incident_guardian_contacts');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === HEALTH_GUARDIAN_CONTACT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's health incident guardian contact by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from health_incident_guardian_contacts where id = $1', [
        HEALTH_GUARDIAN_CONTACT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's health incident guardian contact", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update health_incident_guardian_contacts set notes = 'HACKED' where id = $1 returning id`,
        [HEALTH_GUARDIAN_CONTACT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });

    it('A session with NO tenant context set sees zero health incident guardian contact rows', async () => {
      const rows = await queryAsTenant(null, 'select id from health_incident_guardian_contacts');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero health incident guardian contact rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from health_incident_guardian_contacts',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('medication_administration_log', () => {
    it('Tenant A can see its own medication log entry', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, medication_name from medication_administration_log');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(MEDICATION_LOG_IN_TENANT_A);
      expect(rows[0].medication_name).toBe('Salbutamol inhaler');
    });

    it("Tenant B CANNOT see Tenant A's medication log entry by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from medication_administration_log');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === MEDICATION_LOG_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's medication log entry by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from medication_administration_log where id = $1', [
        MEDICATION_LOG_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's medication log entry", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update medication_administration_log set dosage = 'HACKED' where id = $1 returning id`,
        [MEDICATION_LOG_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });

    it('A session with NO tenant context set sees zero medication log entry rows', async () => {
      const rows = await queryAsTenant(null, 'select id from medication_administration_log');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero medication log entry rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from medication_administration_log',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('inventory_items', () => {
    it('Tenant A can see its own inventory item', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, name from inventory_items');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(INVENTORY_ITEM_IN_TENANT_A);
      expect(rows[0].name).toBe('Exercise Book (A4)');
    });

    it("Tenant B CANNOT see Tenant A's inventory item by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from inventory_items');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === INVENTORY_ITEM_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's inventory item by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from inventory_items where id = $1', [
        INVENTORY_ITEM_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's inventory item", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update inventory_items set quantity_on_hand = 0 where id = $1 returning id`,
        [INVENTORY_ITEM_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ quantity_on_hand: number }>(
        TENANT_A,
        'select quantity_on_hand from inventory_items where id = $1',
        [INVENTORY_ITEM_IN_TENANT_A],
      );
      expect(check[0].quantity_on_hand).toBe(50);
    });

    it('A session with NO tenant context set sees zero inventory item rows', async () => {
      const rows = await queryAsTenant(null, 'select id from inventory_items');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero inventory item rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from inventory_items');
      expect(rows).toHaveLength(0);
    });
  });

  describe('inventory_issuances', () => {
    it('Tenant A can see its own inventory issuance', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, purpose from inventory_issuances');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(INVENTORY_ISSUANCE_IN_TENANT_A);
      expect(rows[0].purpose).toBe('Term 2 stationery issue');
    });

    it("Tenant B CANNOT see Tenant A's inventory issuance by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from inventory_issuances');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === INVENTORY_ISSUANCE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's inventory issuance by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from inventory_issuances where id = $1', [
        INVENTORY_ISSUANCE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's inventory issuance", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update inventory_issuances set purpose = 'HACKED' where id = $1 returning id`,
        [INVENTORY_ISSUANCE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });

    it('A session with NO tenant context set sees zero inventory issuance rows', async () => {
      const rows = await queryAsTenant(null, 'select id from inventory_issuances');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero inventory issuance rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from inventory_issuances');
      expect(rows).toHaveLength(0);
    });
  });

  describe('inventory_alerts', () => {
    it('Tenant A can see its own inventory alert', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, quantity_on_hand from inventory_alerts');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(INVENTORY_ALERT_IN_TENANT_A);
      expect(rows[0].quantity_on_hand).toBe(15);
    });

    it("Tenant B CANNOT see Tenant A's inventory alert by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from inventory_alerts');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === INVENTORY_ALERT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's inventory alert by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from inventory_alerts where id = $1', [
        INVENTORY_ALERT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's inventory alert", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update inventory_alerts set quantity_on_hand = 0 where id = $1 returning id`,
        [INVENTORY_ALERT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });

    it('A session with NO tenant context set sees zero inventory alert rows', async () => {
      const rows = await queryAsTenant(null, 'select id from inventory_alerts');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero inventory alert rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from inventory_alerts');
      expect(rows).toHaveLength(0);
    });
  });

  describe('audit_log', () => {
    it('Tenant A can see its own audit log entry', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, action from audit_log');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(AUDIT_LOG_IN_TENANT_A);
      expect(rows[0].action).toBe('create');
    });

    it("Tenant B CANNOT see Tenant A's audit log entry by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from audit_log');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === AUDIT_LOG_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's audit log entry by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from audit_log where id = $1', [AUDIT_LOG_IN_TENANT_A]);
      expect(rows).toHaveLength(0);
    });

    it(
      "Tenant B CANNOT insert an audit_log row forging Tenant A's tenant_id " +
        '(audit_log is append-only for pbsms_app — no UPDATE grant exists at all, ' +
        'so the row-forgery/WITH CHECK path, not UPDATE, is the operation that ' +
        'actually applies to this table; Postgres raises a hard RLS-violation ' +
        'error here rather than silently excluding the row, unlike a plain ' +
        "SELECT/UPDATE that just returns zero rows — WITH CHECK on INSERT is a " +
        'reject, not a filter)',
      async () => {
        await expect(
          queryAsTenant(
            TENANT_B,
            `insert into audit_log (tenant_id, actor_user_id, actor_role_codes, action, method, path, status_code)
             values ($1, $2, array['headmaster'], 'create', 'POST', '/forged', 201) returning id`,
            [TENANT_A, '99999999-0000-0000-0000-000000000001'],
          ),
        ).rejects.toThrow(/row-level security/i);
      },
    );

    it('A session with NO tenant context set sees zero audit log rows', async () => {
      const rows = await queryAsTenant(null, 'select id from audit_log');
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero audit log rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from audit_log');
      expect(rows).toHaveLength(0);
    });
  });

  // tenant_users has had RLS since 0001_init_tenancy.sql but never had its
  // own describe block here — a pre-existing gap, not something new. Plain
  // select/insert/update/delete grant (see 0001's "RESTRICTED APPLICATION
  // ROLE" section), so the standard 6-test shape applies as-is, unlike
  // audit_log's append-only variant above.
  describe('tenant_users', () => {
    it('Tenant A can see its own tenant_users membership row', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, role_code from tenant_users where id = $1', [
        TENANT_USER_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].role_code).toBe('teacher');
    });

    it("Tenant B CANNOT see Tenant A's tenant_users rows by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from tenant_users');
      // Tenant B sees only its own 2 rows (proprietor + the teacher added
      // in 0026_delegation.sql's seed, for a real distinct delegation
      // recipient) — never Tenant A's.
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === TENANT_USER_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's tenant_users row by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from tenant_users where id = $1', [
        TENANT_USER_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's tenant_users row", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update tenant_users set role_code = 'HACKED' where id = $1 returning id`,
        [TENANT_USER_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ role_code: string }>(
        TENANT_A,
        'select role_code from tenant_users where id = $1',
        [TENANT_USER_IN_TENANT_A],
      );
      expect(check[0].role_code).toBe('teacher');
    });

    it('A session with NO tenant context set sees zero tenant_users rows', async () => {
      const rows = await queryAsTenant(null, 'select id from tenant_users where id = $1', [
        TENANT_USER_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero tenant_users rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from tenant_users where id = $1',
        [TENANT_USER_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('guardians', () => {
    it('Tenant A can see its own guardian', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, full_name from guardians where id = $1', [
        GUARDIAN_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].full_name).toBe("Ama Mensah's Guardian");
    });

    it("Tenant B CANNOT see Tenant A's guardian by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from guardians');
      expect(rows).toHaveLength(1); // Tenant B sees only its own guardian
      expect(rows.find((r) => r.id === GUARDIAN_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's guardian by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from guardians where id = $1', [GUARDIAN_IN_TENANT_A]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's guardian", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update guardians set full_name = 'HACKED' where id = $1 returning id`,
        [GUARDIAN_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ full_name: string }>(
        TENANT_A,
        'select full_name from guardians where id = $1',
        [GUARDIAN_IN_TENANT_A],
      );
      expect(check[0].full_name).toBe("Ama Mensah's Guardian");
    });

    it('A session with NO tenant context set sees zero guardian rows', async () => {
      const rows = await queryAsTenant(null, 'select id from guardians where id = $1', [GUARDIAN_IN_TENANT_A]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero guardian rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from guardians where id = $1',
        [GUARDIAN_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('student_guardians', () => {
    it('Tenant A can see its own student_guardians link', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, relationship from student_guardians where id = $1', [
        STUDENT_GUARDIAN_LINK_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].relationship).toBe('mother');
    });

    it("Tenant B CANNOT see Tenant A's student_guardians link by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from student_guardians');
      expect(rows).toHaveLength(1); // Tenant B sees only its own link
      expect(rows.find((r) => r.id === STUDENT_GUARDIAN_LINK_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's student_guardians link by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from student_guardians where id = $1', [
        STUDENT_GUARDIAN_LINK_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's student_guardians link", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update student_guardians set relationship = 'HACKED' where id = $1 returning id`,
        [STUDENT_GUARDIAN_LINK_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ relationship: string }>(
        TENANT_A,
        'select relationship from student_guardians where id = $1',
        [STUDENT_GUARDIAN_LINK_IN_TENANT_A],
      );
      expect(check[0].relationship).toBe('mother');
    });

    it('A session with NO tenant context set sees zero student_guardians rows', async () => {
      const rows = await queryAsTenant(null, 'select id from student_guardians where id = $1', [
        STUDENT_GUARDIAN_LINK_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero student_guardians rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from student_guardians where id = $1',
        [STUDENT_GUARDIAN_LINK_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('guardian_access_grants', () => {
    it('Tenant A can see its own access grant', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, guardian_id from guardian_access_grants where id = $1', [
        GUARDIAN_ACCESS_GRANT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].guardian_id).toBe(GUARDIAN_IN_TENANT_A);
    });

    it("Tenant B CANNOT see Tenant A's access grant by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from guardian_access_grants');
      expect(rows).toHaveLength(0); // Tenant B has never minted one
      expect(rows.find((r) => r.id === GUARDIAN_ACCESS_GRANT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's access grant by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from guardian_access_grants where id = $1', [
        GUARDIAN_ACCESS_GRANT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's access grant", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update guardian_access_grants set revoked_at = now() where id = $1 returning id`,
        [GUARDIAN_ACCESS_GRANT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ revoked_at: string | null }>(
        TENANT_A,
        'select revoked_at from guardian_access_grants where id = $1',
        [GUARDIAN_ACCESS_GRANT_IN_TENANT_A],
      );
      expect(check[0].revoked_at).toBeNull();
    });

    it('A session with NO tenant context set sees zero access grant rows', async () => {
      const rows = await queryAsTenant(null, 'select id from guardian_access_grants where id = $1', [
        GUARDIAN_ACCESS_GRANT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero access grant rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from guardian_access_grants where id = $1',
        [GUARDIAN_ACCESS_GRANT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('teacher_assignments', () => {
    it('Tenant A can see its own teacher assignment', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, status from teacher_assignments where id = $1', [
        TEACHER_ASSIGNMENT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('active');
    });

    it("Tenant B CANNOT see Tenant A's teacher assignment by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from teacher_assignments');
      expect(rows).toHaveLength(1); // Tenant B sees only its own assignment
      expect(rows.find((r) => r.id === TEACHER_ASSIGNMENT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's teacher assignment by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from teacher_assignments where id = $1', [
        TEACHER_ASSIGNMENT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's teacher assignment", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update teacher_assignments set status = 'ended' where id = $1 returning id`,
        [TEACHER_ASSIGNMENT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from teacher_assignments where id = $1',
        [TEACHER_ASSIGNMENT_IN_TENANT_A],
      );
      expect(check[0].status).toBe('active');
    });

    it('A session with NO tenant context set sees zero teacher_assignments rows', async () => {
      const rows = await queryAsTenant(null, 'select id from teacher_assignments where id = $1', [
        TEACHER_ASSIGNMENT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero teacher_assignments rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from teacher_assignments where id = $1',
        [TEACHER_ASSIGNMENT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('role_delegations', () => {
    it('Tenant A can see its own role delegation', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, role_codes from role_delegations where id = $1', [
        ROLE_DELEGATION_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].role_codes).toEqual(['headmaster']);
    });

    it("Tenant B CANNOT see Tenant A's role delegation by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from role_delegations');
      expect(rows).toHaveLength(1); // Tenant B sees only its own delegation
      expect(rows.find((r) => r.id === ROLE_DELEGATION_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's role delegation by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from role_delegations where id = $1', [
        ROLE_DELEGATION_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's role delegation", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update role_delegations set reason = 'HACKED' where id = $1 returning id`,
        [ROLE_DELEGATION_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ reason: string }>(
        TENANT_A,
        'select reason from role_delegations where id = $1',
        [ROLE_DELEGATION_IN_TENANT_A],
      );
      expect(check[0].reason).toBe('Headmaster on leave');
    });

    it('A session with NO tenant context set sees zero role_delegations rows', async () => {
      const rows = await queryAsTenant(null, 'select id from role_delegations where id = $1', [
        ROLE_DELEGATION_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero role_delegations rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from role_delegations where id = $1',
        [ROLE_DELEGATION_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('background_jobs', () => {
    it('Tenant A can see its own background job', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, job_type from background_jobs where id = $1', [
        BACKGROUND_JOB_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].job_type).toBe('report_card_batch');
    });

    it("Tenant B CANNOT see Tenant A's background job by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from background_jobs');
      expect(rows).toHaveLength(1); // Tenant B sees only its own job
      expect(rows.find((r) => r.id === BACKGROUND_JOB_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's background job by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from background_jobs where id = $1', [
        BACKGROUND_JOB_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's background job", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update background_jobs set status = 'succeeded' where id = $1 returning id`,
        [BACKGROUND_JOB_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from background_jobs where id = $1',
        [BACKGROUND_JOB_IN_TENANT_A],
      );
      expect(check[0].status).toBe('queued');
    });

    it('A session with NO tenant context set sees zero background_jobs rows', async () => {
      const rows = await queryAsTenant(null, 'select id from background_jobs where id = $1', [
        BACKGROUND_JOB_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero background_jobs rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from background_jobs where id = $1',
        [BACKGROUND_JOB_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('job_schedules', () => {
    it('Tenant A can see its own job schedule', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, frequency from job_schedules where id = $1', [
        JOB_SCHEDULE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].frequency).toBe('termly');
    });

    it("Tenant B CANNOT see Tenant A's job schedule by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from job_schedules');
      expect(rows).toHaveLength(1); // Tenant B sees only its own schedule
      expect(rows.find((r) => r.id === JOB_SCHEDULE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's job schedule by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from job_schedules where id = $1', [
        JOB_SCHEDULE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's job schedule", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update job_schedules set is_active = false where id = $1 returning id`,
        [JOB_SCHEDULE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ is_active: boolean }>(
        TENANT_A,
        'select is_active from job_schedules where id = $1',
        [JOB_SCHEDULE_IN_TENANT_A],
      );
      expect(check[0].is_active).toBe(true);
    });

    it('A session with NO tenant context set sees zero job_schedules rows', async () => {
      const rows = await queryAsTenant(null, 'select id from job_schedules where id = $1', [
        JOB_SCHEDULE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero job_schedules rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from job_schedules where id = $1',
        [JOB_SCHEDULE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('kpi_definitions', () => {
    it('Tenant A can see its own KPI definition', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, code from kpi_definitions where id = $1', [
        KPI_DEFINITION_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].code).toBe('collection-rate');
    });

    it("Tenant B CANNOT see Tenant A's KPI definition by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from kpi_definitions');
      expect(rows).toHaveLength(1); // Tenant B sees only its own definition
      expect(rows.find((r) => r.id === KPI_DEFINITION_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's KPI definition by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from kpi_definitions where id = $1', [
        KPI_DEFINITION_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's KPI definition", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update kpi_definitions set status = 'inactive' where id = $1 returning id`,
        [KPI_DEFINITION_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from kpi_definitions where id = $1',
        [KPI_DEFINITION_IN_TENANT_A],
      );
      expect(check[0].status).toBe('active');
    });

    it('A session with NO tenant context set sees zero kpi_definitions rows', async () => {
      const rows = await queryAsTenant(null, 'select id from kpi_definitions where id = $1', [
        KPI_DEFINITION_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero kpi_definitions rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from kpi_definitions where id = $1',
        [KPI_DEFINITION_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('kpi_snapshots', () => {
    it('Tenant A can see its own KPI snapshot', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, value from kpi_snapshots where id = $1', [
        KPI_SNAPSHOT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('75.00');
    });

    it("Tenant B CANNOT see Tenant A's KPI snapshot by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from kpi_snapshots');
      expect(rows).toHaveLength(1); // Tenant B sees only its own snapshot
      expect(rows.find((r) => r.id === KPI_SNAPSHOT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's KPI snapshot by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from kpi_snapshots where id = $1', [
        KPI_SNAPSHOT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's KPI snapshot", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update kpi_snapshots set status = 'critical' where id = $1 returning id`,
        [KPI_SNAPSHOT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from kpi_snapshots where id = $1',
        [KPI_SNAPSHOT_IN_TENANT_A],
      );
      expect(check[0].status).toBe('warning');
    });

    it('A session with NO tenant context set sees zero kpi_snapshots rows', async () => {
      const rows = await queryAsTenant(null, 'select id from kpi_snapshots where id = $1', [
        KPI_SNAPSHOT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero kpi_snapshots rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from kpi_snapshots where id = $1',
        [KPI_SNAPSHOT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('data_subject_requests', () => {
    it('Tenant A can see its own data subject request', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, request_type from data_subject_requests where id = $1', [
        DATA_SUBJECT_REQUEST_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].request_type).toBe('access');
    });

    it("Tenant B CANNOT see Tenant A's data subject request by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from data_subject_requests');
      expect(rows).toHaveLength(1); // Tenant B sees only its own request
      expect(rows.find((r) => r.id === DATA_SUBJECT_REQUEST_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's data subject request by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from data_subject_requests where id = $1', [
        DATA_SUBJECT_REQUEST_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's data subject request", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update data_subject_requests set status = 'fulfilled' where id = $1 returning id`,
        [DATA_SUBJECT_REQUEST_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from data_subject_requests where id = $1',
        [DATA_SUBJECT_REQUEST_IN_TENANT_A],
      );
      expect(check[0].status).toBe('received');
    });

    it('A session with NO tenant context set sees zero data_subject_requests rows', async () => {
      const rows = await queryAsTenant(null, 'select id from data_subject_requests where id = $1', [
        DATA_SUBJECT_REQUEST_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero data_subject_requests rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from data_subject_requests where id = $1',
        [DATA_SUBJECT_REQUEST_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('consent_records', () => {
    it('Tenant A can see its own consent record', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, channel from consent_records where id = $1', [
        CONSENT_RECORD_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].channel).toBe('sms');
    });

    it("Tenant B CANNOT see Tenant A's consent record by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from consent_records');
      expect(rows).toHaveLength(1); // Tenant B sees only its own consent record
      expect(rows.find((r) => r.id === CONSENT_RECORD_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's consent record by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from consent_records where id = $1', [
        CONSENT_RECORD_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's consent record", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update consent_records set granted = false where id = $1 returning id`,
        [CONSENT_RECORD_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ granted: boolean }>(
        TENANT_A,
        'select granted from consent_records where id = $1',
        [CONSENT_RECORD_IN_TENANT_A],
      );
      expect(check[0].granted).toBe(true);
    });

    it('A session with NO tenant context set sees zero consent_records rows', async () => {
      const rows = await queryAsTenant(null, 'select id from consent_records where id = $1', [
        CONSENT_RECORD_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero consent_records rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from consent_records where id = $1',
        [CONSENT_RECORD_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('school_academic_settings', () => {
    it('Tenant A can see its own academic settings row', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, uses_nacca_curriculum from school_academic_settings where id = $1', [
        SCHOOL_ACADEMIC_SETTINGS_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].uses_nacca_curriculum).toBe(true);
    });

    it("Tenant B CANNOT see Tenant A's academic settings row by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from school_academic_settings');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === SCHOOL_ACADEMIC_SETTINGS_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's academic settings row by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from school_academic_settings where id = $1', [
        SCHOOL_ACADEMIC_SETTINGS_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's academic settings row", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update school_academic_settings set uses_nacca_curriculum = false where id = $1 returning id`,
        [SCHOOL_ACADEMIC_SETTINGS_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ uses_nacca_curriculum: boolean }>(
        TENANT_A,
        'select uses_nacca_curriculum from school_academic_settings where id = $1',
        [SCHOOL_ACADEMIC_SETTINGS_IN_TENANT_A],
      );
      expect(check[0].uses_nacca_curriculum).toBe(true);
    });

    it('A session with NO tenant context set sees zero school_academic_settings rows', async () => {
      const rows = await queryAsTenant(null, 'select id from school_academic_settings where id = $1', [
        SCHOOL_ACADEMIC_SETTINGS_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero school_academic_settings rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from school_academic_settings where id = $1',
        [SCHOOL_ACADEMIC_SETTINGS_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('curriculum_strands', () => {
    it('Tenant A can see its own curriculum strand', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, code from curriculum_strands where id = $1', [
        CURRICULUM_STRAND_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].code).toBe('NUM');
    });

    it("Tenant B CANNOT see Tenant A's curriculum strand by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from curriculum_strands');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === CURRICULUM_STRAND_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's curriculum strand by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from curriculum_strands where id = $1', [
        CURRICULUM_STRAND_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's curriculum strand", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update curriculum_strands set name = 'HACKED' where id = $1 returning id`,
        [CURRICULUM_STRAND_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ name: string }>(TENANT_A, 'select name from curriculum_strands where id = $1', [
        CURRICULUM_STRAND_IN_TENANT_A,
      ]);
      expect(check[0].name).toBe('Number');
    });

    it('A session with NO tenant context set sees zero curriculum_strands rows', async () => {
      const rows = await queryAsTenant(null, 'select id from curriculum_strands where id = $1', [
        CURRICULUM_STRAND_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero curriculum_strands rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from curriculum_strands where id = $1',
        [CURRICULUM_STRAND_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('curriculum_sub_strands', () => {
    it('Tenant A can see its own curriculum sub-strand', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, code from curriculum_sub_strands where id = $1', [
        CURRICULUM_SUB_STRAND_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].code).toBe('NUM-1');
    });

    it("Tenant B CANNOT see Tenant A's curriculum sub-strand by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from curriculum_sub_strands');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === CURRICULUM_SUB_STRAND_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's curriculum sub-strand by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from curriculum_sub_strands where id = $1', [
        CURRICULUM_SUB_STRAND_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's curriculum sub-strand", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update curriculum_sub_strands set name = 'HACKED' where id = $1 returning id`,
        [CURRICULUM_SUB_STRAND_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ name: string }>(
        TENANT_A,
        'select name from curriculum_sub_strands where id = $1',
        [CURRICULUM_SUB_STRAND_IN_TENANT_A],
      );
      expect(check[0].name).toBe('Number and Numeration');
    });

    it('A session with NO tenant context set sees zero curriculum_sub_strands rows', async () => {
      const rows = await queryAsTenant(null, 'select id from curriculum_sub_strands where id = $1', [
        CURRICULUM_SUB_STRAND_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero curriculum_sub_strands rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from curriculum_sub_strands where id = $1',
        [CURRICULUM_SUB_STRAND_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('curriculum_indicators', () => {
    it('Tenant A can see its own curriculum indicator', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, indicator_code from curriculum_indicators where id = $1', [
        CURRICULUM_INDICATOR_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].indicator_code).toBe('B7.1.1.1.1');
    });

    it("Tenant B CANNOT see Tenant A's curriculum indicator by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from curriculum_indicators');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === CURRICULUM_INDICATOR_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's curriculum indicator by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from curriculum_indicators where id = $1', [
        CURRICULUM_INDICATOR_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's curriculum indicator", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update curriculum_indicators set indicator_text = 'HACKED' where id = $1 returning id`,
        [CURRICULUM_INDICATOR_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ indicator_text: string }>(
        TENANT_A,
        'select indicator_text from curriculum_indicators where id = $1',
        [CURRICULUM_INDICATOR_IN_TENANT_A],
      );
      expect(check[0].indicator_text).toBe('Round numbers to the nearest 10, 100 or 1000');
    });

    it('A session with NO tenant context set sees zero curriculum_indicators rows', async () => {
      const rows = await queryAsTenant(null, 'select id from curriculum_indicators where id = $1', [
        CURRICULUM_INDICATOR_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero curriculum_indicators rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from curriculum_indicators where id = $1',
        [CURRICULUM_INDICATOR_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('bece_candidates', () => {
    it('Tenant A can see its own BECE candidate', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, index_number from bece_candidates where id = $1', [
        BECE_CANDIDATE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].index_number).toBe('SUN-20262027-0001');
    });

    it("Tenant B CANNOT see Tenant A's BECE candidate by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from bece_candidates');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === BECE_CANDIDATE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's BECE candidate by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from bece_candidates where id = $1', [
        BECE_CANDIDATE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's BECE candidate", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update bece_candidates set registration_status = 'withdrawn' where id = $1 returning id`,
        [BECE_CANDIDATE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ registration_status: string }>(
        TENANT_A,
        'select registration_status from bece_candidates where id = $1',
        [BECE_CANDIDATE_IN_TENANT_A],
      );
      expect(check[0].registration_status).toBe('registered');
    });

    it('A session with NO tenant context set sees zero bece_candidates rows', async () => {
      const rows = await queryAsTenant(null, 'select id from bece_candidates where id = $1', [
        BECE_CANDIDATE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero bece_candidates rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from bece_candidates where id = $1',
        [BECE_CANDIDATE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('bece_mock_results', () => {
    it('Tenant A can see its own BECE mock result', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, grade from bece_mock_results where id = $1', [
        BECE_MOCK_RESULT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].grade).toBe(3);
    });

    it("Tenant B CANNOT see Tenant A's BECE mock result by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from bece_mock_results');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === BECE_MOCK_RESULT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's BECE mock result by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from bece_mock_results where id = $1', [
        BECE_MOCK_RESULT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's BECE mock result", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update bece_mock_results set grade = 9 where id = $1 returning id`,
        [BECE_MOCK_RESULT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ grade: number }>(TENANT_A, 'select grade from bece_mock_results where id = $1', [
        BECE_MOCK_RESULT_IN_TENANT_A,
      ]);
      expect(check[0].grade).toBe(3);
    });

    it('A session with NO tenant context set sees zero bece_mock_results rows', async () => {
      const rows = await queryAsTenant(null, 'select id from bece_mock_results where id = $1', [
        BECE_MOCK_RESULT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero bece_mock_results rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from bece_mock_results where id = $1',
        [BECE_MOCK_RESULT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('cssps_placements', () => {
    it('Tenant A can see its own CSSPS placement', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, choices from cssps_placements where id = $1', [
        CSSPS_PLACEMENT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].choices).toEqual(['Achimota School', 'Presec Legon']);
    });

    it("Tenant B CANNOT see Tenant A's CSSPS placement by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from cssps_placements');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === CSSPS_PLACEMENT_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's CSSPS placement by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from cssps_placements where id = $1', [
        CSSPS_PLACEMENT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's CSSPS placement", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update cssps_placements set placement_outcome = 'HACKED' where id = $1 returning id`,
        [CSSPS_PLACEMENT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ placement_outcome: string | null }>(
        TENANT_A,
        'select placement_outcome from cssps_placements where id = $1',
        [CSSPS_PLACEMENT_IN_TENANT_A],
      );
      expect(check[0].placement_outcome).toBeNull();
    });

    it('A session with NO tenant context set sees zero cssps_placements rows', async () => {
      const rows = await queryAsTenant(null, 'select id from cssps_placements where id = $1', [
        CSSPS_PLACEMENT_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero cssps_placements rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from cssps_placements where id = $1',
        [CSSPS_PLACEMENT_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('rooms', () => {
    it('Tenant A can see its own room', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, name from rooms where id = $1', [ROOM_IN_TENANT_A]);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Block A - Room 1');
    });

    it("Tenant B CANNOT see Tenant A's room by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from rooms');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === ROOM_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's room by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from rooms where id = $1', [ROOM_IN_TENANT_A]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's room", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update rooms set name = 'HACKED' where id = $1 returning id`,
        [ROOM_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ name: string }>(TENANT_A, 'select name from rooms where id = $1', [
        ROOM_IN_TENANT_A,
      ]);
      expect(check[0].name).toBe('Block A - Room 1');
    });

    it('A session with NO tenant context set sees zero rooms rows', async () => {
      const rows = await queryAsTenant(null, 'select id from rooms where id = $1', [ROOM_IN_TENANT_A]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero rooms rows', async () => {
      const rows = await queryAsTenant('00000000-0000-0000-0000-000000000000', 'select id from rooms where id = $1', [
        ROOM_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });
  });

  describe('periods', () => {
    it('Tenant A can see its own period', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, name from periods where id = $1', [PERIOD_IN_TENANT_A]);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Period 1');
    });

    it("Tenant B CANNOT see Tenant A's period by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from periods');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === PERIOD_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's period by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from periods where id = $1', [PERIOD_IN_TENANT_A]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's period", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update periods set name = 'HACKED' where id = $1 returning id`,
        [PERIOD_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ name: string }>(TENANT_A, 'select name from periods where id = $1', [
        PERIOD_IN_TENANT_A,
      ]);
      expect(check[0].name).toBe('Period 1');
    });

    it('A session with NO tenant context set sees zero periods rows', async () => {
      const rows = await queryAsTenant(null, 'select id from periods where id = $1', [PERIOD_IN_TENANT_A]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero periods rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from periods where id = $1',
        [PERIOD_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('timetable_entries', () => {
    it('Tenant A can see its own timetable entry', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, day_of_week from timetable_entries where id = $1', [
        TIMETABLE_ENTRY_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].day_of_week).toBe('monday');
    });

    it("Tenant B CANNOT see Tenant A's timetable entry by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from timetable_entries');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === TIMETABLE_ENTRY_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's timetable entry by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from timetable_entries where id = $1', [
        TIMETABLE_ENTRY_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's timetable entry", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update timetable_entries set status = 'ended' where id = $1 returning id`,
        [TIMETABLE_ENTRY_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from timetable_entries where id = $1',
        [TIMETABLE_ENTRY_IN_TENANT_A],
      );
      expect(check[0].status).toBe('active');
    });

    it('A session with NO tenant context set sees zero timetable_entries rows', async () => {
      const rows = await queryAsTenant(null, 'select id from timetable_entries where id = $1', [
        TIMETABLE_ENTRY_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero timetable_entries rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from timetable_entries where id = $1',
        [TIMETABLE_ENTRY_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('settlement_batches', () => {
    it('Tenant A can see its own settlement batch', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, source from settlement_batches where id = $1', [
        SETTLEMENT_BATCH_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe('bank_statement');
    });

    it("Tenant B CANNOT see Tenant A's settlement batch by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from settlement_batches');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === SETTLEMENT_BATCH_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's settlement batch by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from settlement_batches where id = $1', [
        SETTLEMENT_BATCH_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's settlement batch", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update settlement_batches set status = 'closed' where id = $1 returning id`,
        [SETTLEMENT_BATCH_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ status: string }>(
        TENANT_A,
        'select status from settlement_batches where id = $1',
        [SETTLEMENT_BATCH_IN_TENANT_A],
      );
      expect(check[0].status).toBe('open');
    });

    it('A session with NO tenant context set sees zero settlement_batches rows', async () => {
      const rows = await queryAsTenant(null, 'select id from settlement_batches where id = $1', [
        SETTLEMENT_BATCH_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero settlement_batches rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from settlement_batches where id = $1',
        [SETTLEMENT_BATCH_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('settlement_lines', () => {
    it('Tenant A can see its own settlement line', async () => {
      const rows = await queryAsTenant(TENANT_A, 'select id, amount from settlement_lines where id = $1', [
        SETTLEMENT_LINE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].amount)).toBe(600);
    });

    it("Tenant B CANNOT see Tenant A's settlement line by listing", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select id from settlement_lines');
      expect(rows).toHaveLength(1);
      expect(rows.find((r) => r.id === SETTLEMENT_LINE_IN_TENANT_A)).toBeUndefined();
    });

    it("Tenant B CANNOT see Tenant A's settlement line by direct id lookup either", async () => {
      const rows = await queryAsTenant(TENANT_B, 'select * from settlement_lines where id = $1', [
        SETTLEMENT_LINE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("Tenant B CANNOT update Tenant A's settlement line", async () => {
      const rows = await queryAsTenant<{ id: string }>(
        TENANT_B,
        `update settlement_lines set match_status = 'matched' where id = $1 returning id`,
        [SETTLEMENT_LINE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);

      const check = await queryAsTenant<{ match_status: string }>(
        TENANT_A,
        'select match_status from settlement_lines where id = $1',
        [SETTLEMENT_LINE_IN_TENANT_A],
      );
      expect(check[0].match_status).toBe('unmatched');
    });

    it('A session with NO tenant context set sees zero settlement_lines rows', async () => {
      const rows = await queryAsTenant(null, 'select id from settlement_lines where id = $1', [
        SETTLEMENT_LINE_IN_TENANT_A,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('A session with an unknown/garbage tenant id sees zero settlement_lines rows', async () => {
      const rows = await queryAsTenant(
        '00000000-0000-0000-0000-000000000000',
        'select id from settlement_lines where id = $1',
        [SETTLEMENT_LINE_IN_TENANT_A],
      );
      expect(rows).toHaveLength(0);
    });
  });
});
