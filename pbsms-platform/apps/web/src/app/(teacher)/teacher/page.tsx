'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card/Card';
import { LoadingState } from '@/components/states/LoadingState';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { apiGet } from '@/lib/api-client';
import { RosterData, activeClassOptions, loadRosterData, rosterForClass } from '@/lib/attendance-roster';
import { componentTypeLabel, findOpenStructure, loadComponents, loadScores, loadStructures, loadSubjects } from '@/lib/assessment-roster';
import styles from './today.module.css';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface RegisterTileState {
  className: string | null;
  markedCount: number;
  rosterSize: number;
}

interface ScoreTileState {
  className: string | null;
  subjectName: string | null;
  componentLabel: string | null;
  scoredCount: number;
  rosterSize: number;
}

/**
 * Spec §6.2 — the Teacher Field App's landing screen. Quick-launch tiles
 * summarize TODAY's register/score status for the teacher's first active
 * assignment (a teacher with several classes picks the specific one on
 * the Register/Scores screens themselves — this tile is a status glance,
 * not a full picker). Timetable is a list of active assignments, not a
 * real scheduled period — no timetable/period model exists in this schema
 * yet (Chapter 17.1's own documented deferral), same simplification
 * teacher-assignments.controller.ts already uses elsewhere.
 */
export default function TeacherTodayPage() {
  const tenantId = decodeAccessToken()?.tenantId ?? null;
  const teacherId = decodeAccessToken()?.sub ?? null;
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<RosterData | null>(null);
  const [registerTile, setRegisterTile] = useState<RegisterTileState | null>(null);
  const [scoreTile, setScoreTile] = useState<ScoreTileState | null>(null);

  useEffect(() => {
    if (!tenantId || !teacherId) return;
    const tId = tenantId;
    const tcId = teacherId;
    let cancelled = false;

    async function load() {
      const data = await loadRosterData(tId, tcId);
      if (cancelled) return;
      setRoster(data);

      const options = activeClassOptions(data);
      if (options.length > 0) {
        const first = options[0];
        const cls = data.classes.find((c) => c.id === first.classId);
        const students = rosterForClass(data, first.classId, first.academicYearId);
        try {
          const records = await apiGet<{ class_id: string; student_id: string; attendance_date: string }[]>('/v1/attendance');
          const today = todayIso();
          const markedToday = new Set(
            records
              .filter((r) => r.class_id === first.classId && r.attendance_date.slice(0, 10) === today)
              .map((r) => r.student_id),
          );
          if (!cancelled) {
            setRegisterTile({ className: cls?.name ?? first.className, markedCount: markedToday.size, rosterSize: students.length });
          }
        } catch {
          if (!cancelled) setRegisterTile({ className: cls?.name ?? first.className, markedCount: -1, rosterSize: students.length });
        }
      } else if (!cancelled) {
        setRegisterTile(null);
      }

      try {
        const [subjects, structures] = await Promise.all([loadSubjects(tId), loadStructures(tId)]);
        // Iterate real assignments, not the class-deduped `options` list —
        // scores are keyed by class+SUBJECT+year, and a teacher can hold
        // two subject assignments on the same class.
        const activeAssignments = data.assignments.filter((a) => a.status === 'active');
        let match: { classId: string; academicYearId: string; structure: (typeof structures)[number] } | null = null;
        for (const a of activeAssignments) {
          const structure = findOpenStructure(structures, a.class_id, a.subject_id, a.academic_year_id);
          if (structure) {
            match = { classId: a.class_id, academicYearId: a.academic_year_id, structure };
            break;
          }
        }

        if (match && !cancelled) {
          const { classId, academicYearId, structure } = match;
          const components = await loadComponents(tId, structure.id);
          const component = components[0] ?? null;
          const cls = data.classes.find((c) => c.id === classId);
          const subject = subjects.find((s) => s.id === structure.subject_id);
          const students = rosterForClass(data, classId, academicYearId);
          if (component) {
            const scores = await loadScores(tId, component.id);
            if (!cancelled) {
              setScoreTile({
                className: cls?.name ?? 'Class',
                subjectName: subject?.name ?? null,
                componentLabel: componentTypeLabel(component.component_type),
                scoredCount: scores.length,
                rosterSize: students.length,
              });
            }
          } else if (!cancelled) {
            setScoreTile({ className: cls?.name ?? 'Class', subjectName: subject?.name ?? null, componentLabel: null, scoredCount: 0, rosterSize: students.length });
          }
        } else if (!cancelled) {
          setScoreTile(null);
        }
      } catch {
        if (!cancelled) setScoreTile(null);
      }
    }

    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId, teacherId]);

  const timetableRows = useMemo(() => {
    if (!roster) return [];
    return activeClassOptions(roster).map((o) => {
      const cls = roster.classes.find((c) => c.id === o.classId);
      const assignment = roster.assignments.find((a) => a.class_id === o.classId && a.academic_year_id === o.academicYearId);
      return { key: `${o.classId}:${o.academicYearId}`, className: cls?.name ?? o.className, subjectId: assignment?.subject_id ?? null };
    });
  }, [roster]);

  if (!tenantId || !teacherId) return null;

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading today" rows={4} />
      </Card>
    );
  }

  return (
    <div>
      <div className={styles.tiles}>
        <Link href="/teacher/register" style={{ display: 'flex', textDecoration: 'none' }}>
          <Card className={styles.tile}>
            <span className={styles.tileLabel}>Take register</span>
            {registerTile ? (
              <>
                <span className={styles.tileClass}>{registerTile.className}</span>
                <span className={styles.tileStatus}>
                  {registerTile.markedCount < 0
                    ? 'Open register'
                    : registerTile.markedCount === 0
                      ? 'not yet marked'
                      : `${registerTile.markedCount} of ${registerTile.rosterSize} done`}
                </span>
              </>
            ) : (
              <span className={styles.tileStatus}>No assigned class</span>
            )}
          </Card>
        </Link>
        <Link href="/teacher/scores" style={{ display: 'flex', textDecoration: 'none' }}>
          <Card className={styles.tile}>
            <span className={styles.tileLabel}>Enter scores</span>
            {scoreTile ? (
              <>
                <span className={styles.tileClass}>
                  {scoreTile.subjectName} · {scoreTile.componentLabel ?? scoreTile.className}
                </span>
                <span className={styles.tileStatus}>{scoreTile.scoredCount} of {scoreTile.rosterSize} done</span>
              </>
            ) : (
              <span className={styles.tileStatus}>Nothing open to score</span>
            )}
          </Card>
        </Link>
      </div>

      <Card style={{ padding: 'var(--pb-space-4)' }}>
        <p className={styles.timetableTitle}>Today&apos;s assignments</p>
        {timetableRows.length === 0 && <p className={styles.tileStatus}>No active class assignments.</p>}
        {timetableRows.map((row) => (
          <div key={row.key} className={styles.timetableRow}>
            <span>{row.className}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
