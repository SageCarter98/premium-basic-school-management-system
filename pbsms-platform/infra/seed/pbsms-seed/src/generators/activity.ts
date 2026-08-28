import { PROFILES, type SeedConfig, type TenantSpec } from '../config.js';
import { TEACHER_COMMENTS } from '../corpus.js';
import { addDays, at, nextId, schoolDays, type Rng } from '../rng.js';
import type {
  AssessmentComponent, AssessmentInstance, AttendanceRecord, AttendanceStatus, GradeBand,
  ResultLine, ResultSet, ResultVersion, Score, TenantGraph, Term,
} from '../types.js';
import { schoolOfClass, subjectsForClass } from './academic.js';
import { buildRosterIndex, rosterOf } from './people.js';

const ABSENCE_REASONS = [
  'Guardian reported illness',
  'Funeral',
  'Travelled with family',
  'Reported late — traffic on the Adenta road',
  'No reason given',
];

const GRADE_BANDS: { grade: string; min: number; max: number; remark: string; pass: boolean }[] = [
  { grade: 'A', min: 80, max: 100, remark: 'Excellent', pass: true },
  { grade: 'B', min: 70, max: 79, remark: 'Very good', pass: true },
  { grade: 'C', min: 60, max: 69, remark: 'Good', pass: true },
  { grade: 'D', min: 50, max: 59, remark: 'Credit', pass: true },
  { grade: 'E', min: 40, max: 49, remark: 'Pass', pass: false },
  { grade: 'F', min: 0, max: 39, remark: 'Fail', pass: false },
];

function gradeFor(percent: number): { grade: string; pass: boolean } {
  const b = GRADE_BANDS.find((x) => percent >= x.min && percent <= x.max) ?? GRADE_BANDS[GRADE_BANDS.length - 1];
  return { grade: b.grade, pass: b.pass };
}

export function generateActivity(g: TenantGraph, spec: TenantSpec, cfg: SeedConfig, rng: Rng): void {
  const p = PROFILES[cfg.profile];
  const tid = g.tenant.id;
  const scope = spec.slug;
  const attRng = rng.stream('attendance');
  const scoreRng = rng.stream('scores');
  const resRng = rng.stream('results');

  // Indexes built once. Every lookup below is a Map hit, not a scan.
  const rosterIdx = buildRosterIndex(g);
  const scoreByInstanceStudent = new Map<string, Score>();
  const instancesByKey = new Map<string, AssessmentInstance[]>();
  const componentById = new Map<string, AssessmentComponent>();

  for (const school of g.schools) {
    const years = g.academic_years.filter((y) => y.school_id === school.id).sort((a, b) => a.label.localeCompare(b.label));
    const currentYear = years[years.length - 1];
    const campusIds = new Set(g.campuses.filter((c) => c.school_id === school.id).map((c) => c.id));
    const currentClasses = g.classes.filter((c) => campusIds.has(c.campus_id) && c.academic_year_id === currentYear.id);
    const currentTerms = g.terms.filter((t) => t.academic_year_id === currentYear.id).sort((a, b) => a.sequence - b.sequence);
    const teachers = g.staff.filter((s) => s.school_id === school.id && s.roles.includes('teacher'));
    const head = g.staff.find((s) => s.school_id === school.id && s.roles.includes('headmaster'))!;
    const coordinator = g.staff.find((s) => s.school_id === school.id && s.roles.includes('academic_coordinator'))!;

    /* ------------------------------------------------------ grading scale */
    // Two versions, so FR-GRA-070 (policy versioning) has something to read and
    // a prior-year result cannot be silently re-graded under today's scale.
    const oldScale = {
      tenant_id: tid, id: nextId('gsc', scope), school_id: school.id,
      name: 'School Grading Scale', version: 1,
      effective_from: years[0].starts_on, superseded_on: currentYear.starts_on,
    };
    const newScale = {
      tenant_id: tid, id: nextId('gsc', scope), school_id: school.id,
      name: 'School Grading Scale', version: 2,
      effective_from: currentYear.starts_on, superseded_on: null,
    };
    g.grading_scales.push(oldScale, newScale);
    for (const scale of [oldScale, newScale]) {
      for (const b of GRADE_BANDS) {
        const band: GradeBand = {
          tenant_id: tid, id: nextId('gbd', scope), grading_scale_id: scale.id,
          grade: b.grade, min_percent: b.min, max_percent: b.max, remark: b.remark, is_pass: b.pass,
        };
        g.grade_bands.push(band);
      }
    }

    /* -------------------------------------------- assessment components */
    // Correct set: 30 + 20 + 50 = 100.
    // One school in the fixture gets 30 + 20 + 47 = 97 so the publication gate
    // has a live blocking condition to render (FR-ASM-010, §8.4).
    const breakWeights = school.id.endsWith('0002') || g.schools.length === 1;
    const weights = breakWeights ? [30, 20, 47] : [30, 20, 50];
    const compNames = ['Class Score', 'Mid-term Test', 'End of Term Examination'];
    const components: AssessmentComponent[] = [];
    for (let i = 0; i < 3; i++) {
      const c: AssessmentComponent = {
        tenant_id: tid,
        id: nextId('acp', scope),
        school_id: school.id,
        academic_year_id: currentYear.id,
        name: compNames[i],
        weight_percent: weights[i],
        max_score: weights[i] === 47 ? 100 : 100,
        sequence: i + 1,
        probe: breakWeights && i === 2 ? 'weights_do_not_total_100' : null,
      };
      components.push(c);
      componentById.set(c.id, c);
      g.assessment_components.push(c);
    }

    /* -------------------------------------------------------- attendance */
    for (const term of currentTerms) {
      if (term.state === 'planned') continue;
      const lastDay = term.state === 'active' ? cfg.asOf : term.ends_on;
      const all = schoolDays(term.starts_on, lastDay);
      const days = p.attendanceDaysPerTerm === -1 ? all : attRng.sample(all, p.attendanceDaysPerTerm).sort();
      if (days.length === 0) continue;

      for (const cls of currentClasses) {
        const teacher = teachers[currentClasses.indexOf(cls) % teachers.length];
        for (const day of days) {
          const roster = rosterOf(g, cls, day, rosterIdx);
          for (const st of roster) {
            const status = attRng.weighted<AttendanceStatus>(
              ['present', 'absent', 'late', 'excused', 'sick'],
              [0.895, 0.045, 0.035, 0.015, 0.01],
            );
            const offline = attRng.bool(0.35);
            const isPendingQueue = term.state === 'active' && day === days[days.length - 1] && attRng.bool(0.25);
            const rec: AttendanceRecord = {
              tenant_id: tid,
              id: nextId('att', scope),
              student_id: st.id,
              class_id: cls.id,
              term_id: term.id,
              on_date: day,
              status,
              reason: status === 'present' ? null : attRng.pick(ABSENCE_REASONS),
              marked_by: teacher.id,
              marked_at: at(day, 8, attRng.int(0, 30)),
              device_id: `dev_${teacher.id}`,
              captured_offline: offline,
              // An unsynced row is the whole point of the SyncLedger. If every
              // row in the fixture is synced, the offline UI has nothing to show.
              synced_at: isPendingQueue ? null : at(day, 8, attRng.int(31, 59)),
              corrects_record_id: null,
              correction_reason: null,
            };
            g.attendance_records.push(rec);
          }
        }
      }
    }

    /* ------------------- attendance edge cases: correction and conflict */
    const schoolAtt = g.attendance_records.filter((a) => currentClasses.some((c) => c.id === a.class_id));

    // Correction that retains the original (FR-ATT-030): the original row stays,
    // a new row points at it. Nothing is UPDATEd in place.
    const toCorrect = schoolAtt.find((a) => a.status === 'absent' && a.synced_at !== null);
    if (toCorrect) {
      g.attendance_records.push({
        ...toCorrect,
        id: nextId('att', scope),
        status: 'excused',
        reason: 'Medical note produced the following day',
        marked_by: head.id,
        marked_at: at(addDays(toCorrect.on_date, 1), 10, 15),
        captured_offline: false,
        synced_at: at(addDays(toCorrect.on_date, 1), 10, 15),
        corrects_record_id: toCorrect.id,
        correction_reason: 'Guardian produced a hospital card after the register was submitted',
      });
    }

    // Conflict: two different staff mark the same student on the same day with
    // different values (FR-ATT-011). Never auto-resolved.
    const conflictBase = schoolAtt.find((a) => a.status === 'present' && a.id !== toCorrect?.id);
    if (conflictBase && teachers.length > 1) {
      const other = teachers.find((t) => t.id !== conflictBase.marked_by) ?? teachers[0];
      const rival: AttendanceRecord = {
        ...conflictBase,
        id: nextId('att', scope),
        status: 'absent',
        reason: 'Not seen in class',
        marked_by: other.id,
        marked_at: at(conflictBase.on_date, 8, 55),
        device_id: `dev_${other.id}`,
        captured_offline: true,
        synced_at: at(conflictBase.on_date, 17, 12),
        corrects_record_id: null,
        correction_reason: null,
      };
      g.attendance_records.push(rival);
      g.attendance_conflicts.push({
        tenant_id: tid,
        id: nextId('acf', scope),
        student_id: conflictBase.student_id,
        on_date: conflictBase.on_date,
        record_a_id: conflictBase.id,
        record_b_id: rival.id,
        state: 'open',
        resolved_record_id: null,
        resolved_by: null,
      });
    }

    /* ------------------------------------------ assessments and scores */
    for (const term of currentTerms) {
      if (term.state === 'planned') continue;
      for (const cls of currentClasses) {
        const subjects = subjectsForClass(g, cls);
        const teacher = teachers[currentClasses.indexOf(cls) % teachers.length];
        for (const subj of subjects) {
          for (const comp of components) {
            const administered = comp.sequence === 1
              ? addDays(term.starts_on, 20)
              : comp.sequence === 2
                ? addDays(term.starts_on, 38)
                : addDays(term.ends_on, -10);
            if (administered > cfg.asOf) continue;

            const isActiveTerm = term.state === 'active';
            const inst: AssessmentInstance = {
              tenant_id: tid,
              id: nextId('ain', scope),
              component_id: comp.id,
              class_id: cls.id,
              subject_id: subj.id,
              term_id: term.id,
              administered_on: administered,
              state: isActiveTerm ? 'open' : 'locked',
            };
            g.assessment_instances.push(inst);
            const key = `${cls.id}|${subj.id}|${term.id}`;
            const bucket = instancesByKey.get(key);
            if (bucket) bucket.push(inst); else instancesByKey.set(key, [inst]);

            const roster = rosterOf(g, cls, administered, rosterIdx);
            // In the active term, entry is deliberately incomplete — the
            // "18 of 32 done" state the teacher app is built around.
            const entered = isActiveTerm ? Math.round(roster.length * 0.56) : roster.length;

            for (const [i, st] of roster.entries()) {
              const isEntered = i < entered;
              const ability = 55 + ((st.id.charCodeAt(st.id.length - 1) % 9) * 3);
              const raw = Math.round(scoreRng.normal(ability, 13, 0, 100));
              const state: Score['state'] = !isEntered
                ? 'pending'
                : scoreRng.bool(0.02)
                  ? 'absent'
                  : scoreRng.bool(0.01)
                    ? 'exempt'
                    : 'recorded';
              const offline = isActiveTerm && scoreRng.bool(0.4);
              const score: Score = {
                tenant_id: tid,
                id: nextId('scr', scope),
                assessment_instance_id: inst.id,
                student_id: st.id,
                raw_score: state === 'recorded' ? raw : null,
                max_score: comp.max_score,
                state,
                entered_by: teacher.id,
                entered_at: at(addDays(administered, 2), 14, scoreRng.int(0, 59)),
                captured_offline: offline,
                synced_at: offline && scoreRng.bool(0.3) ? null : at(addDays(administered, 2), 15, scoreRng.int(0, 59)),
              };
              g.scores.push(score);
              scoreByInstanceStudent.set(`${inst.id}|${st.id}`, score);
            }
          }
        }
      }
    }

    /* --------------------------------------------------------- results */
    for (const term of currentTerms) {
      if (term.state === 'planned') continue;
      for (const cls of currentClasses) {
        const isActiveTerm = term.state === 'active';
        const blocking: string[] = [];
        if (isActiveTerm) {
          blocking.push('Score entry is still open for this term');
          let missing = 0;
          for (const subj of subjectsForClass(g, cls)) {
            for (const inst of instancesByKey.get(`${cls.id}|${subj.id}|${term.id}`) ?? []) {
              for (const st of rosterOf(g, cls, inst.administered_on, rosterIdx)) {
                if (scoreByInstanceStudent.get(`${inst.id}|${st.id}`)?.state === 'pending') missing++;
              }
            }
          }
          if (missing > 0) blocking.push(`${missing} scores not yet entered`);
        }
        if (breakWeights) blocking.push('Assessment weights total 97%, not 100%');

        const set: ResultSet = {
          tenant_id: tid,
          id: nextId('rst', scope),
          class_id: cls.id,
          term_id: term.id,
          state: isActiveTerm ? (blocking.length > 1 ? 'draft' : 'under_review') : 'published',
          blocking_reasons: blocking,
          submitted_by: isActiveTerm ? null : cls.class_teacher_id,
          approved_by: isActiveTerm ? null : head.id,
          published_at: isActiveTerm ? null : at(addDays(term.ends_on, 4), 11, 0),
        };
        g.result_sets.push(set);
        if (isActiveTerm) continue;

        const v1: ResultVersion = {
          tenant_id: tid,
          id: nextId('rvs', scope),
          result_set_id: set.id,
          version: 1,
          published_at: set.published_at!,
          published_by: head.id,
          supersedes_version_id: null,
          reopen_reason: null,
          reopen_authorised_by: null,
          is_current: true,
        };
        g.result_versions.push(v1);

        const roster = rosterOf(g, cls, term.ends_on, rosterIdx);
        const subjects = subjectsForClass(g, cls);
        const totals = new Map<string, number>();
        const linesForVersion: ResultLine[] = [];
        for (const st of roster) {
          let sum = 0;
          for (const subj of subjects) {
            let weighted = 0;
            for (const inst of instancesByKey.get(`${cls.id}|${subj.id}|${term.id}`) ?? []) {
              const r = scoreByInstanceStudent.get(`${inst.id}|${st.id}`);
              if (!r) continue;
              const comp = componentById.get(inst.component_id)!;
              const pct = r.state === 'recorded' && r.raw_score !== null ? r.raw_score / r.max_score : 0;
              weighted += pct * comp.weight_percent;
            }
            const rounded = Math.round(weighted * 10) / 10;
            sum += rounded;
            const line: ResultLine = {
              tenant_id: tid,
              id: nextId('rln', scope),
              result_version_id: v1.id,
              student_id: st.id,
              subject_id: subj.id,
              weighted_percent: rounded,
              grade: gradeFor(rounded).grade,
              position_in_class: null,
              teacher_comment: resRng.bool(0.4) ? resRng.pick(TEACHER_COMMENTS) : null,
            };
            g.result_lines.push(line);
            linesForVersion.push(line);
          }
          totals.set(st.id, sum);
        }
        // Class positions, ties share a position.
        const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
        const rank = new Map(ranked.map(([sid], i) => [sid, i + 1]));
        for (const line of linesForVersion) {
          line.position_in_class = rank.get(line.student_id) ?? null;
        }
      }
    }

    /* --- a published result later revised: v1 superseded, both retrievable */
    const publishedSets = g.result_sets.filter(
      (r) => r.state === 'published' && currentClasses.some((c) => c.id === r.class_id),
    );
    const revisable = publishedSets.find((r) => {
      const t = g.terms.find((x) => x.id === r.term_id)!;
      return t.sequence === 1;
    });
    if (revisable) {
      const v1 = g.result_versions.find((v) => v.result_set_id === revisable.id && v.version === 1)!;
      v1.is_current = false;
      const v2: ResultVersion = {
        tenant_id: tid,
        id: nextId('rvs', scope),
        result_set_id: revisable.id,
        version: 2,
        published_at: at(addDays(v1.published_at.slice(0, 10), 9), 15, 30),
        published_by: head.id,
        supersedes_version_id: v1.id,
        reopen_reason: 'Integrated Science end-of-term marks were transposed for two students',
        reopen_authorised_by: coordinator.id,
        is_current: true,
      };
      g.result_versions.push(v2);
      // v2 carries a full copy of the lines with two corrected. v1's lines are
      // never mutated — that is the FR-RES-030 guarantee, and a test that
      // rewrites v1 in place should fail against this fixture.
      const v1Lines = g.result_lines.filter((l) => l.result_version_id === v1.id);

      v1Lines.forEach((l, i) => {
        const corrected = i < 2 ? Math.min(100, l.weighted_percent + 9.5) : l.weighted_percent;
        g.result_lines.push({
          ...l,
          id: nextId('rln', scope),
          result_version_id: v2.id,
          weighted_percent: Math.round(corrected * 10) / 10,
          grade: gradeFor(corrected).grade,
        });
      });
    }
  }
}

export function activeTermOf(g: TenantGraph, schoolId: string): Term | undefined {
  const yearIds = new Set(g.academic_years.filter((y) => y.school_id === schoolId).map((y) => y.id));
  return g.terms.find((t) => t.state === 'active' && yearIds.has(t.academic_year_id));
}

export { schoolOfClass };
