/**
 * golden-cases.ts — §47.15.1's golden set: "no fewer than 100
 * question/answer pairs constructed against a seeded reference tenant with
 * known-correct answers... coverage across every role... because scope
 * enforcement fails per role, not globally."
 *
 * There is exactly one retrieval capability today (attendance_below_
 * threshold — see STAGE-1-SPEC.md), so "100 pairs" means 100+ varied
 * query/role/scope combinations against that one capability, not 100
 * capabilities — confirmed against the task brief and against §47.15.1's
 * own text, which specifies "per capability".
 *
 * Each case's "known-correct answer" is not a hand-typed number: it's the
 * (thresholdPercentage, startDate, endDate, classKey, scope) input,
 * resolved at test time to a real service call AND independently to
 * oracle.computeExpected() over the same fixture data — see oracle.ts's
 * header for why a shared-implementation oracle would prove nothing.
 *
 * Every case has a stable, human-readable `id` — see
 * apps/api/tools/check-assistant-eval-integrity.ts (EC-400-style
 * append-only enforcement for this file and adversarial-cases.ts): a case
 * may be added freely, but an existing case's `id` disappearing, or its
 * frozen fields (role/threshold/dates/classKey/scope) changing under the
 * same `id`, fails that check against the PR's base commit.
 */

import { OracleScope } from './oracle';
import {
  QUERY_START,
  QUERY_END,
  SUBWINDOW_EARLY_START,
  SUBWINDOW_EARLY_END,
  SUBWINDOW_LATE_START,
  SUBWINDOW_LATE_END,
  SUBWINDOW_MID_START,
  SUBWINDOW_MID_END,
  TENANT_A,
  TENANT_B,
  HEADMASTER,
  TEACHER_A,
  PROPRIETOR_B,
} from './fixtures';
import { ALL_ROUTE_ACCESSIBLE_ROLE_CODES, UNRESTRICTED_ROLE_CODES } from './role-coverage';

export interface GoldenCase {
  id: string;
  description: string;
  tenantId: string;
  actorUserId: string;
  roles: string[];
  thresholdPercentage: number;
  startDate: string;
  endDate: string;
  classKey?: string; // fixture class key (fixtures.ts) — resolved to a real classId at run time
  oracleScope: OracleScope;
  /** Which fixture class set (CLASSES_A/CLASSES_B) the case's tenant uses. */
  classSet: 'A' | 'B';
}

const UNRESTRICTED_SCOPE: OracleScope = { unrestricted: true, classKeys: new Set() };
const TEACHER_A_SCOPE: OracleScope = { unrestricted: false, classKeys: new Set(['E1', 'E3']) };

const THRESHOLDS = [10, 25, 50, 65, 75, 90, 100];
const TEACHER_THRESHOLDS = [25, 50, 75, 100];
const CLASS_KEYS_A = ['E1', 'E2', 'E3', 'E4'];

const cases: GoldenCase[] = [];

// --- A) Baseline threshold sweep, every ACADEMIC_STAFF role except teacher, full window, no classId filter ---
for (const roleCode of UNRESTRICTED_ROLE_CODES) {
  for (const threshold of THRESHOLDS) {
    cases.push({
      id: `baseline-${roleCode}-t${threshold}`,
      description: `${roleCode} (unrestricted), threshold ${threshold}%, full window, all classes`,
      tenantId: TENANT_A,
      actorUserId: HEADMASTER,
      roles: [roleCode],
      thresholdPercentage: threshold,
      startDate: QUERY_START,
      endDate: QUERY_END,
      oracleScope: UNRESTRICTED_SCOPE,
      classSet: 'A',
    });
  }
}

// --- B) classId-filter sweep, every unrestricted role (same full role list as A) ---
for (const roleCode of UNRESTRICTED_ROLE_CODES) {
  for (const classKey of CLASS_KEYS_A) {
    cases.push({
      id: `classfilter-${roleCode}-${classKey}`,
      description: `${roleCode} (unrestricted), threshold 75%, classId filter = ${classKey}`,
      tenantId: TENANT_A,
      actorUserId: HEADMASTER,
      roles: [roleCode],
      thresholdPercentage: 75,
      startDate: QUERY_START,
      endDate: QUERY_END,
      classKey,
      oracleScope: UNRESTRICTED_SCOPE,
      classSet: 'A',
    });
  }
}

// --- C) Teacher (Tenant A, assigned E1+E3 — see fixtures.ts) — every classId filter × a threshold sample ---
const TEACHER_CLASS_KEYS: Array<string | undefined> = [undefined, 'E1', 'E2', 'E3', 'E4'];
for (const classKey of TEACHER_CLASS_KEYS) {
  for (const threshold of TEACHER_THRESHOLDS) {
    cases.push({
      id: `teacher-${classKey ?? 'all'}-t${threshold}`,
      description: `teacher (scoped to E1+E3), threshold ${threshold}%, classId filter = ${classKey ?? '(none)'}`,
      tenantId: TENANT_A,
      actorUserId: TEACHER_A,
      roles: ['teacher'],
      thresholdPercentage: threshold,
      startDate: QUERY_START,
      endDate: QUERY_END,
      classKey,
      oracleScope: TEACHER_A_SCOPE,
      classSet: 'A',
    });
  }
}

// --- D) Date sub-window cases — confirms FR-AIT-202-style "retrieval executes against the requested window", not the whole fixture ---
const SUBWINDOWS: Array<{ key: string; start: string; end: string }> = [
  { key: 'early', start: SUBWINDOW_EARLY_START, end: SUBWINDOW_EARLY_END },
  { key: 'late', start: SUBWINDOW_LATE_START, end: SUBWINDOW_LATE_END },
  { key: 'mid', start: SUBWINDOW_MID_START, end: SUBWINDOW_MID_END },
];
const SUBWINDOW_ROLES: Array<{ roleCode: string; actorUserId: string; scope: OracleScope }> = [
  { roleCode: 'headmaster', actorUserId: HEADMASTER, scope: UNRESTRICTED_SCOPE },
  { roleCode: 'academic_coordinator', actorUserId: HEADMASTER, scope: UNRESTRICTED_SCOPE },
  { roleCode: 'teacher', actorUserId: TEACHER_A, scope: TEACHER_A_SCOPE },
];
for (const { roleCode, actorUserId, scope } of SUBWINDOW_ROLES) {
  for (const window of SUBWINDOWS) {
    cases.push({
      id: `subwindow-${roleCode}-${window.key}`,
      description: `${roleCode}, threshold 50%, date sub-window "${window.key}" (${window.start}..${window.end})`,
      tenantId: TENANT_A,
      actorUserId,
      roles: [roleCode],
      thresholdPercentage: 50,
      startDate: window.start,
      endDate: window.end,
      oracleScope: scope,
      classSet: 'A',
    });
  }
}

// --- F) Edge cases ---
cases.push(
  {
    id: 'edge-threshold-zero-headmaster',
    description: 'headmaster, threshold 0% — no percentage is ever < 0, so this must always be empty',
    tenantId: TENANT_A,
    actorUserId: HEADMASTER,
    roles: ['headmaster'],
    thresholdPercentage: 0,
    startDate: QUERY_START,
    endDate: QUERY_END,
    oracleScope: UNRESTRICTED_SCOPE,
    classSet: 'A',
  },
  {
    id: 'edge-threshold-zero-teacher',
    description: 'teacher, threshold 0% — same reasoning, scoped role',
    tenantId: TENANT_A,
    actorUserId: TEACHER_A,
    roles: ['teacher'],
    thresholdPercentage: 0,
    startDate: QUERY_START,
    endDate: QUERY_END,
    oracleScope: TEACHER_A_SCOPE,
    classSet: 'A',
  },
  {
    id: 'edge-date-range-outside-fixture-window',
    description: 'headmaster, threshold 100%, date range entirely outside the fixture — must be empty, not an error',
    tenantId: TENANT_A,
    actorUserId: HEADMASTER,
    roles: ['headmaster'],
    thresholdPercentage: 100,
    startDate: '2027-04-01',
    endDate: '2027-04-05',
    oracleScope: UNRESTRICTED_SCOPE,
    classSet: 'A',
  },
);

// --- G) Tenant B: proprietor (unrestricted) correctly sees BOTH schools' classes in the same tenant ---
// (the "cross-school elicitation" NEGATIVE case — a teacher denied the
// other school's class — lives in adversarial-cases.ts; this is the
// paired POSITIVE case: unrestricted roles are supposed to see across
// schools within their own tenant, per the Frontend Design Spec §10's
// "Proprietor / Director... sees: All schools in tenant".)
cases.push({
  id: 'crossschool-proprietor-b-sees-both-schools',
  description: 'Tenant B proprietor (unrestricted), threshold 100%, no classId filter — sees both GG-NKG and GG-PJHS classes',
  tenantId: TENANT_B,
  actorUserId: PROPRIETOR_B,
  roles: ['proprietor'],
  thresholdPercentage: 100,
  startDate: QUERY_START,
  endDate: QUERY_END,
  oracleScope: UNRESTRICTED_SCOPE,
  classSet: 'B',
});

export const GOLDEN_CASES: readonly GoldenCase[] = cases;

// Every route-accessible role code (role-coverage.ts) must appear in at
// least one golden case — a role silently missing from this file would be
// exactly the "coverage across every role" gap §47.15.1 warns about.
export function assertEveryRouteAccessibleRoleCovered(): void {
  const covered = new Set(GOLDEN_CASES.flatMap((c) => c.roles));
  const missing = ALL_ROUTE_ACCESSIBLE_ROLE_CODES.filter((r) => !covered.has(r));
  if (missing.length > 0) {
    throw new Error(`golden-cases.ts has no case at all for role code(s): ${missing.join(', ')}`);
  }
}
