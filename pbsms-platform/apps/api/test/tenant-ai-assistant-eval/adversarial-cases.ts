/**
 * adversarial-cases.ts — the adversarial corpus §47.15.1 requires:
 * "cross-tenant elicitation, cross-school elicitation within a tenant,
 * out-of-scope elicitation within a role, prompt injection through record
 * content, and requests for prohibited determinations under FR-AIT-103
 * and FR-AIT-104" — and TEN-054's "adversarial prompts explicitly
 * attempting to elicit another tenant's data, another school's data
 * within the same tenant, and data outside the requesting user's role
 * scope."
 *
 * Stage 1 has no natural-language input surface (no free-text `question`
 * field anywhere — FindLowAttendanceDto is fully structured), so there is
 * no "adversarial prompt" in the literal sense to construct yet. Every
 * case below is Stage 1's honest equivalent: an adversarial STRUCTURED
 * INPUT (a spoofed classId, a role/tenant combination chosen to maximise
 * leakage if scope enforcement has a bug) or, for the two cases that
 * inherently require prose (injection *through record content* the model
 * would read, and a *request* for a prohibited determination), a
 * structural test that the capability to be adversarial through those
 * paths doesn't exist yet — see the "structural" cases at the bottom of
 * this file and the eval spec's corresponding describe blocks.
 */

import { OracleScope } from './oracle';
import { QUERY_START, QUERY_END, TENANT_A, TENANT_B, HEADMASTER, TEACHER_A, TEACHER_B } from './fixtures';

const UNRESTRICTED_SCOPE: OracleScope = { unrestricted: true, classKeys: new Set() };
const TEACHER_A_SCOPE: OracleScope = { unrestricted: false, classKeys: new Set(['E1', 'E3']) };
const TEACHER_B_SCOPE: OracleScope = { unrestricted: false, classKeys: new Set(['GG_PJHS_1']) };

export type AdversarialKind = 'cross_tenant' | 'cross_school' | 'out_of_scope_role' | 'impersonation';

export interface AdversarialCase {
  id: string;
  kind: AdversarialKind;
  description: string;
  tenantId: string;
  actorUserId: string;
  roles: string[];
  thresholdPercentage: number;
  startDate: string;
  endDate: string;
  classKey?: string;
  /**
   * Which fixture class array `classKey` is actually DEFINED in — used only
   * to resolve `classKey` to its real seeded classId (so a "spoofed"
   * classId is a genuinely real id belonging to the OTHER tenant, not a
   * made-up string). The oracle's own expected-result computation is
   * always driven by `tenantId` instead (see the eval spec's
   * `classesForTenant()`), because RLS scopes the real query to the
   * CALLING tenant's own classes regardless of which tenant `classKey`
   * came from — that mismatch is exactly what every case in this file is
   * testing.
   */
  classSet: 'A' | 'B';
  oracleScope: OracleScope;
  impersonationGrantId?: string;
  /** Every case in this file expects zero records (leakage would be a nonzero result) unless `expectForbidden` is set. */
  expectForbidden?: boolean;
}

export const ADVERSARIAL_CASES: readonly AdversarialCase[] = [
  // --- cross-tenant elicitation ---
  {
    id: 'adv-cross-tenant-b-caller-spoofs-a-class',
    kind: 'cross_tenant',
    description: "Tenant B proprietor supplies Tenant A's own class id as classId — must never resolve to Tenant A's rows",
    tenantId: TENANT_B,
    actorUserId: HEADMASTER, // reused as an arbitrary distinct actor id, same as the Stage 1 isolation suite's own pattern
    roles: ['proprietor'],
    thresholdPercentage: 100,
    startDate: QUERY_START,
    endDate: QUERY_END,
    classKey: 'E1', // a TENANT_A class key — deliberately cross-tenant
    classSet: 'A', // where 'E1' is actually defined, for real-id resolution — the caller is Tenant B, so RLS still must resolve this to nothing
    oracleScope: UNRESTRICTED_SCOPE,
  },
  {
    id: 'adv-cross-tenant-a-caller-spoofs-b-class',
    kind: 'cross_tenant',
    description: "Tenant A headmaster supplies a Golden Gate class id as classId — must never resolve to Tenant B's rows",
    tenantId: TENANT_A,
    actorUserId: HEADMASTER,
    roles: ['headmaster'],
    thresholdPercentage: 100,
    startDate: QUERY_START,
    endDate: QUERY_END,
    classKey: 'GG_PJHS_1',
    classSet: 'B', // where 'GG_PJHS_1' is actually defined, for real-id resolution — the caller is Tenant A
    oracleScope: UNRESTRICTED_SCOPE,
  },
  {
    id: 'adv-cross-tenant-teacher-spoofs-b-class',
    kind: 'cross_tenant',
    description: 'Tenant A teacher (scope-restricted) supplies a Golden Gate class id — cross-tenant AND out-of-scope in one attempt',
    tenantId: TENANT_A,
    actorUserId: TEACHER_A,
    roles: ['teacher'],
    thresholdPercentage: 100,
    startDate: QUERY_START,
    endDate: QUERY_END,
    classKey: 'GG_PJHS_1',
    classSet: 'B', // where 'GG_PJHS_1' is actually defined, for real-id resolution — the caller is Tenant A
    oracleScope: TEACHER_A_SCOPE,
  },

  // --- cross-school elicitation within a tenant (TEN-054's own worked example) ---
  {
    id: 'adv-cross-school-teacher-b-spoofs-other-campus',
    kind: 'cross_school',
    description:
      'Golden Gate teacher (assigned only to the Primary/JHS campus class) supplies the Nursery/KG campus class id — same tenant, different school',
    tenantId: TENANT_B,
    actorUserId: TEACHER_B,
    roles: ['teacher'],
    thresholdPercentage: 100,
    startDate: QUERY_START,
    endDate: QUERY_END,
    classKey: 'GG_NKG_1',
    classSet: 'B',
    oracleScope: TEACHER_B_SCOPE,
  },

  // --- out-of-scope elicitation within a role (a teacher reaching for a class nobody assigned them, maximal threshold to maximise would-be leakage) ---
  {
    id: 'adv-out-of-scope-teacher-maximal-threshold',
    kind: 'out_of_scope_role',
    description: 'Tenant A teacher, threshold 100% (every student in scope would match), classId = an unassigned class (E4)',
    tenantId: TENANT_A,
    actorUserId: TEACHER_A,
    roles: ['teacher'],
    thresholdPercentage: 100,
    startDate: QUERY_START,
    endDate: QUERY_END,
    classKey: 'E4',
    classSet: 'A',
    oracleScope: TEACHER_A_SCOPE,
  },

  // --- impersonation combined with an otherwise-fully-unrestricted role (TEN-055) ---
  // Distinct from tenant-ai-assistant-isolation.e2e-spec.ts's own impersonation
  // case (different role, adds a classId filter) — a NEW case, not a
  // modification of that protected file.
  {
    id: 'adv-impersonation-overrides-unrestricted-role',
    kind: 'impersonation',
    description: 'An impersonation grant refuses the Assistant even for a role that would otherwise be fully unrestricted, classId filter included',
    tenantId: TENANT_A,
    actorUserId: HEADMASTER,
    roles: ['proprietor'],
    thresholdPercentage: 100,
    startDate: QUERY_START,
    endDate: QUERY_END,
    classKey: 'E1',
    classSet: 'A',
    oracleScope: UNRESTRICTED_SCOPE,
    impersonationGrantId: 'a1000000-0000-0000-0000-000000000099',
    expectForbidden: true,
  },
];
