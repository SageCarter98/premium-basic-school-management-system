'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { apiGet } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { ACADEMIC_ADMIN, LEADERSHIP, TEACHING_STAFF, hasAnyRole } from '@/lib/role-groups';
import styles from './dashboard.module.css';

function money(n: number): string {
  return `GH₵${n.toFixed(2)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * dashboard/page.tsx — closes the "literal Stage-2 placeholder" gap
 * README.md's 2026-08-20 walkthrough flagged (every role landed on the
 * same stub message). Four real views, routed by the caller's own
 * roleCodes (same client-declutters/server-decides posture every other
 * role-gated screen in this app already uses — each view's own data
 * calls are independently role-enforced backend-side regardless of what
 * renders here):
 *  - LEADERSHIP → the Chapter 14 group roll-up (collection/attendance/
 *    academic-performance per school, via the real analytics endpoint).
 *  - accountant (non-LEADERSHIP) → Finance's own outstanding-balances
 *    dashboard endpoint (FR-FIN-040), one of the eight that endpoint was
 *    always meant to back.
 *  - teacher (non-LEADERSHIP/accountant) → their own active assignments
 *    (teacher-assignments.controller.ts's findAll() already record-scopes
 *    this to "my own" for a non-admin caller) plus today's attendance
 *    status for those classes, filtered client-side since the read
 *    endpoint returns tenant-wide and isn't itself day/class-scoped.
 *  - everyone else (single-department specialist roles — library/
 *    transport/health/inventory — and the ACADEMIC_ADMIN-but-not-
 *    LEADERSHIP academic-office roles, which don't cleanly fit any of
 *    the three named views above) → an honest welcome + a direct link
 *    into their own module, not a fabricated metric — same "don't build
 *    a stub that looks real" discipline this codebase applies elsewhere
 *    (stubbed payment methods reject outright rather than pretend to
 *    charge a card).
 */
export default function DashboardPage() {
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];

  if (hasAnyRole(roleCodes, LEADERSHIP)) return <LeadershipDashboard />;
  if (roleCodes.includes('accountant')) return <AccountantDashboard />;
  if (hasAnyRole(roleCodes, TEACHING_STAFF)) return <TeacherDashboard />;
  return <SpecialistDashboard roleCodes={roleCodes} />;
}

// ---------------------------------------------------------------------
// Leadership — Chapter 14 group roll-up
// ---------------------------------------------------------------------

interface SchoolRollup {
  schoolId: string;
  schoolName: string;
  collectionRate: number;
  attendanceRate: number;
  // computeAcademicPerformance() returns null when a school has no
  // current, approved result yet for the period — an honest "no data",
  // not a 0 (analytics.service.ts's own header) — must stay nullable
  // here or a school with zero results crashes this page.
  academicPerformance: number | null;
}

// analytics.service.ts's computeCollectionRate()/computeAttendanceRate()/
// computeAcademicPerformance() all already return a 0-100 percentage
// (e.g. Math.round((present/total)*10000)/100), not a 0-1 fraction — no
// second *100 needed here.
function pct(n: number | null): string {
  return n === null ? '—' : `${n.toFixed(1)}%`;
}

function LeadershipDashboard() {
  const [range, setRange] = useState({ periodStart: daysAgoIso(90), periodEnd: todayIso() });
  const [data, setData] = useState<{ schools: SchoolRollup[]; outstandingActionsCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    apiGet<{ schools: SchoolRollup[]; outstandingActionsCount: number }>(
      `/v1/analytics/group-rollup?periodStart=${range.periodStart}&periodEnd=${range.periodEnd}`,
    )
      .then(setData)
      .catch(() => setError('Could not load the roll-up for this period.'))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  return (
    <div>
      <h1>Dashboard</h1>
      <p className={styles.greeting}>Group roll-up across every school for the selected period.</p>

      <div className={styles.formRow}>
        <input
          aria-label="Period start"
          className={styles.textInput}
          type="date"
          value={range.periodStart}
          onChange={(e) => setRange({ ...range, periodStart: e.target.value })}
        />
        <input
          aria-label="Period end"
          className={styles.textInput}
          type="date"
          value={range.periodEnd}
          onChange={(e) => setRange({ ...range, periodEnd: e.target.value })}
        />
        <button type="button" onClick={load} className={styles.textInput} style={{ cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      {loading && <LoadingState label="Loading roll-up" rows={4} />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <>
          <div className={styles.statGrid}>
            <Card className={styles.statTile}>
              <div className={styles.statValue}>{data.outstandingActionsCount}</div>
              <div className={styles.statLabel}>Outstanding actions (tenant-wide)</div>
            </Card>
          </div>

          {data.schools.length === 0 ? (
            <EmptyState title="No schools yet" message="Create a school to see it in the roll-up." />
          ) : (
            data.schools.map((s) => (
              <Card key={s.schoolId} style={{ padding: 'var(--pb-space-4)', marginBottom: 'var(--pb-space-3)' }}>
                <div className={styles.sectionTitle} style={{ marginTop: 0 }}>
                  {s.schoolName}
                </div>
                <div className={styles.statGrid} style={{ marginBottom: 0 }}>
                  <div>
                    <div className={styles.statValue}>{pct(s.collectionRate)}</div>
                    <div className={styles.statLabel}>Fee collection rate</div>
                  </div>
                  <div>
                    <div className={styles.statValue}>{pct(s.attendanceRate)}</div>
                    <div className={styles.statLabel}>Attendance rate</div>
                  </div>
                  <div>
                    <div className={styles.statValue}>{pct(s.academicPerformance)}</div>
                    <div className={styles.statLabel}>Academic performance</div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Accountant — outstanding/overdue balances
// ---------------------------------------------------------------------

interface OutstandingBalance {
  invoice_id: string;
  invoice_number: string;
  student_id: string;
  total_amount: string;
  balance: number;
  due_date: string | null;
  overdue: boolean;
}

interface StudentLite {
  id: string;
  first_name: string;
  last_name: string;
}

function AccountantDashboard() {
  const [rows, setRows] = useState<OutstandingBalance[]>([]);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiGet<OutstandingBalance[]>('/v1/finance/dashboard/outstanding-balances'), apiGet<StudentLite[]>('/v1/students')])
      .then(([b, s]) => {
        setRows(b);
        setStudents(s);
      })
      .catch(() => setError('Could not load outstanding balances.'))
      .finally(() => setLoading(false));
  }, []);

  const studentName = (id: string) => {
    const s = students.find((x) => x.id === id);
    return s ? `${s.first_name} ${s.last_name}` : id;
  };

  const totalOutstanding = rows.reduce((sum, r) => sum + r.balance, 0);
  const overdueRows = rows.filter((r) => r.overdue);
  const topRows = [...rows].sort((a, b) => b.balance - a.balance).slice(0, 10);

  if (loading) return <LoadingState label="Loading collections" rows={4} />;
  if (error) return <ErrorState message={error} />;

  return (
    <div>
      <h1>Dashboard</h1>
      <p className={styles.greeting}>Collections summary across every posted invoice with a balance.</p>

      <div className={styles.statGrid}>
        <Card className={styles.statTile}>
          <div className={styles.statValue}>{money(totalOutstanding)}</div>
          <div className={styles.statLabel}>Total outstanding</div>
        </Card>
        <Card className={styles.statTile}>
          <div className={styles.statValue}>{rows.length}</div>
          <div className={styles.statLabel}>Invoices with a balance</div>
        </Card>
        <Card className={styles.statTile}>
          <div className={styles.statValue}>{overdueRows.length}</div>
          <div className={styles.statLabel}>Overdue</div>
        </Card>
      </div>

      <div className={styles.sectionTitle}>Largest outstanding balances</div>
      {topRows.length === 0 ? (
        <EmptyState title="Nothing outstanding" message="Every posted invoice is fully paid or assisted." />
      ) : (
        <Card style={{ padding: 'var(--pb-space-4)' }}>
          {topRows.map((r) => (
            <div key={r.invoice_id} className={styles.listRow}>
              <span>
                {studentName(r.student_id)} · {r.invoice_number}
              </span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                {r.overdue && <Pill variant="danger">Overdue</Pill>}
                {money(r.balance)}
              </span>
            </div>
          ))}
        </Card>
      )}
      <p className={styles.hint} style={{ marginTop: 'var(--pb-space-3)' }}>
        <Link href="/finance">Open Finance</Link> for the full invoice and payment workspace.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Teacher — my classes + today's attendance status
// ---------------------------------------------------------------------

interface TeacherAssignment {
  id: string;
  class_id: string;
  subject_id: string;
  academic_year_id: string;
  status: string;
  is_class_teacher: boolean;
}

interface AttendanceRecord {
  class_id: string;
  attendance_date: string;
}

function TeacherDashboard() {
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [markedToday, setMarkedToday] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // findAll() record-scopes this to "my own assignments" server-side for
    // a non-admin caller (teacher-assignments.controller.ts's own header) —
    // no teacherId filter needed here.
    Promise.all([apiGet<TeacherAssignment[]>('/v1/teacher-assignments'), apiGet<AttendanceRecord[]>('/v1/attendance')])
      .then(([a, records]) => {
        const active = a.filter((x) => x.status === 'active');
        setAssignments(active);
        const today = todayIso();
        setMarkedToday(new Set(records.filter((r) => r.attendance_date === today).map((r) => r.class_id)));
      })
      .catch(() => setError('Could not load your classes.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState label="Loading your classes" rows={3} />;
  if (error) return <ErrorState message={error} />;

  const uniqueClassIds = Array.from(new Set(assignments.map((a) => a.class_id)));
  const markedCount = uniqueClassIds.filter((id) => markedToday.has(id)).length;

  return (
    <div>
      <h1>Dashboard</h1>
      <p className={styles.greeting}>Your active class assignments and today&apos;s attendance status.</p>

      <div className={styles.statGrid}>
        <Card className={styles.statTile}>
          <div className={styles.statValue}>{assignments.length}</div>
          <div className={styles.statLabel}>Active assignments</div>
        </Card>
        <Card className={styles.statTile}>
          <div className={styles.statValue}>
            {markedCount}/{uniqueClassIds.length}
          </div>
          <div className={styles.statLabel}>Classes marked today</div>
        </Card>
      </div>

      <div className={styles.sectionTitle}>My classes</div>
      {assignments.length === 0 ? (
        <EmptyState title="No active assignments" message="Ask your academic office to assign you to a class." />
      ) : (
        <Card style={{ padding: 'var(--pb-space-4)' }}>
          {assignments.map((a) => (
            <div key={a.id} className={styles.listRow}>
              <span>Class {a.class_id.slice(0, 8)} · Subject {a.subject_id.slice(0, 8)}</span>
              <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
                {a.is_class_teacher && <Pill variant="gold">Class teacher</Pill>}
                {markedToday.has(a.class_id) ? (
                  <Pill variant="success">Marked today</Pill>
                ) : (
                  <Pill variant="warning">Not marked yet</Pill>
                )}
              </span>
            </div>
          ))}
        </Card>
      )}
      <p className={styles.hint} style={{ marginTop: 'var(--pb-space-3)' }}>
        <Link href="/teacher">Open the Teacher Field App</Link> to mark attendance and enter scores.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Specialist / academic-office default — no fabricated metrics, a
// direct link into the one module each of these roles actually owns.
// ---------------------------------------------------------------------

const ROLE_LINKS: Record<string, { label: string; href: string }> = {
  librarian: { label: 'Library', href: '/library' },
  transport_officer: { label: 'Transport', href: '/transport' },
  health_officer: { label: 'Health', href: '/health' },
  storekeeper: { label: 'Inventory', href: '/inventory' },
  academic_coordinator: { label: 'Academic Structure', href: '/classes' },
  examination_officer: { label: 'Assessment', href: '/assessment' },
  admission_officer: { label: 'Students', href: '/students' },
  assistant_headmaster: { label: 'Academic Structure', href: '/classes' },
};

function SpecialistDashboard({ roleCodes }: { roleCodes: string[] }) {
  const links = roleCodes.map((r) => ROLE_LINKS[r]).filter((x): x is { label: string; href: string } => Boolean(x));
  const uniqueLinks = Array.from(new Map(links.map((l) => [l.href, l])).values());

  return (
    <div>
      <h1>Dashboard</h1>
      <p className={styles.greeting}>
        Welcome back. {hasAnyRole(roleCodes, ACADEMIC_ADMIN) ? 'Your academic office tools are below.' : 'Your module is below.'}
      </p>
      {uniqueLinks.length === 0 ? (
        <EmptyState title="Nothing pinned here yet" message="Use the sidebar to reach your tools." />
      ) : (
        <div className={styles.statGrid}>
          {uniqueLinks.map((l) => (
            <Card key={l.href} style={{ padding: 0 }}>
              <Link href={l.href} className={styles.linkCard}>
                <div className={styles.linkCardTitle}>{l.label}</div>
                <div className={styles.statLabel}>Open {l.label.toLowerCase()}</div>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
