/**
 * oracle.ts — an independent (plain-TypeScript, non-SQL) re-implementation
 * of what AssistantRetrievalService.findLowAttendance() is supposed to
 * compute, used to produce the "known-correct answer" half of every
 * golden query/answer pair (§47.15.1). This is deliberately NOT a copy of
 * assistant-retrieval.service.ts's SQL — a golden set whose oracle shares
 * a bug with the thing it's checking proves nothing. Given the same
 * fixture data (fixtures.ts) and the same caller scope, this and the real
 * service's SQL should always agree; a disagreement is either a real
 * defect in the service or a real defect in this oracle, and either way
 * is worth finding.
 *
 * Rounding: every window length used by this eval harness (2, 4, 5, 10
 * days) divides 10 evenly, so `presentCount / totalDays * 100` always
 * lands on an exact multiple of 10, 20, or 25 — never a repeating decimal
 * — so there is no rounding-mode mismatch to worry about between this
 * oracle's arithmetic and Postgres's `round(numeric, 1)`. Deliberate: see
 * fixtures.ts's header.
 */

import { ClassFixture, StudentFixture, buildStatuses } from './fixtures';

export interface OracleRow {
  studentKey: string;
  classKey: string;
  presentDays: number;
  totalDays: number;
  attendancePercentage: number;
}

export interface OracleResult {
  records: OracleRow[];
  totalCount: number;
  truncated: boolean;
}

const MAX_RECORDS = 50;
const WINDOW_START_MS = Date.parse('2027-03-01T00:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 0-based day offset from the fixed 10-day window's first day. Computed
 * via real date arithmetic (not slicing the day-of-month digits) — an
 * earlier version compared only the "0N" suffix, which silently treated
 * every month's Nth day as the same index. That collapsed a
 * genuinely-outside-the-fixture-window date range (e.g. April) onto the
 * March window instead of correctly falling entirely outside it — caught
 * live by the "date range entirely outside the fixture" golden case,
 * whose real service call correctly returned zero while this oracle,
 * before the fix, wrongly expected eight.
 */
function dateIndex(isoDate: string): number {
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - WINDOW_START_MS) / MS_PER_DAY);
}

/** Recomputes a student's present/total days for an arbitrary sub-window of the fixed 10-day pattern. */
function computeAttendance(student: StudentFixture, startDate: string, endDate: string): { present: number; total: number } {
  const statuses = buildStatuses(student.presentCount);
  const from = Math.max(0, dateIndex(startDate));
  const to = Math.min(statuses.length - 1, dateIndex(endDate));
  let present = 0;
  let total = 0;
  for (let i = from; i <= to; i++) {
    total++;
    if (statuses[i] === 'present') present++;
  }
  return { present, total };
}

export interface OracleScope {
  unrestricted: boolean;
  classKeys: Set<string>; // fixture class keys, not DB ids — matches TeacherScope.classIds' semantics
}

/**
 * Independently computes the expected AssistantRecordSet for a query
 * against `classes` (already filtered to the caller's tenant by the
 * caller), given a Chapter-13.3 scope and an optional classId filter —
 * mirrors assistant-retrieval.service.ts's own scope-then-classId-filter
 * order, but as a second, from-scratch implementation.
 */
export function computeExpected(
  classes: ClassFixture[],
  scope: OracleScope,
  query: { thresholdPercentage: number; startDate: string; endDate: string; classKey?: string },
): OracleResult {
  const eligibleClasses = classes.filter((c) => {
    if (query.classKey && c.key !== query.classKey) return false;
    if (!scope.unrestricted && !scope.classKeys.has(c.key)) return false;
    return true;
  });

  const rows: OracleRow[] = [];
  for (const cls of eligibleClasses) {
    for (const student of cls.students) {
      const { present, total } = computeAttendance(student, query.startDate, query.endDate);
      if (total === 0) continue; // matches the SQL's implicit behaviour: no rows in window, no group produced
      const percentage = Math.round((present / total) * 1000) / 10; // 1 decimal, exact for our window lengths
      if (percentage < query.thresholdPercentage) {
        rows.push({ studentKey: student.key, classKey: cls.key, presentDays: present, totalDays: total, attendancePercentage: percentage });
      }
    }
  }

  rows.sort((a, b) => a.attendancePercentage - b.attendancePercentage);
  const truncated = rows.length > MAX_RECORDS;
  return { records: rows.slice(0, MAX_RECORDS), totalCount: rows.length, truncated };
}
