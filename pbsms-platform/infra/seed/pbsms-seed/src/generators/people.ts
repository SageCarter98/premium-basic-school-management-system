import { PROFILES, type SeedConfig, type TenantSpec } from '../config.js';
import {
  CLASS_LADDER, FIRST_NAMES_F, FIRST_NAMES_M, MIDDLE_NAMES, OCCUPATIONS, PHONE_PREFIXES, SURNAMES,
} from '../corpus.js';
import { addDays, nextId, type Rng } from '../rng.js';
import type {
  Enrolment, Guardian, GuardianLink, SchoolClass, Staff, StaffRole, Student, TenantGraph,
} from '../types.js';
import { schoolOfClass, subjectsForClass } from './academic.js';

function phone(rng: Rng): string {
  const prefix = rng.pick(PHONE_PREFIXES).slice(1); // '024' -> '24'
  let rest = '';
  for (let i = 0; i < 7; i++) rest += rng.int(0, 10);
  return `+233${prefix}${rest}`;
}

function personName(rng: Rng, sex: 'M' | 'F') {
  const first = rng.pick(sex === 'M' ? FIRST_NAMES_M : FIRST_NAMES_F);
  const last = rng.pick(SURNAMES);
  const middle = rng.bool(0.35) ? rng.pick(MIDDLE_NAMES) : null;
  return { first, middle, last };
}

function slugEmail(first: string, last: string, domain: string, n: number): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  return `${norm(first)}.${norm(last)}${n > 1 ? n : ''}@${domain}`;
}

export function generatePeople(g: TenantGraph, spec: TenantSpec, cfg: SeedConfig, rng: Rng): void {
  const p = PROFILES[cfg.profile];
  const tid = g.tenant.id;
  const scope = spec.slug;
  const domain = `${spec.slug}.edu.gh`;
  let emailN = 0;

  const staffRng = rng.stream('staff');
  const studentRng = rng.stream('students');
  const guardianRng = rng.stream('guardians');

  for (const school of g.schools) {
    const schoolCampuses = g.campuses.filter((c) => c.school_id === school.id);
    const campusIds = new Set(schoolCampuses.map((c) => c.id));
    const schoolClasses = g.classes.filter((c) => campusIds.has(c.campus_id));
    const years = g.academic_years.filter((y) => y.school_id === school.id).sort((a, b) => a.label.localeCompare(b.label));
    const priorYear = years[0];
    const currentYear = years[years.length - 1];

    /* ---------------------------------------------------------- staff */
    const adminRoles: StaffRole[][] = [
      ['proprietor'], ['headmaster'], ['accountant'], ['academic_coordinator'],
      ['admissions_officer'], ['health_officer'],
    ];
    for (const roles of adminRoles) {
      const sex = staffRng.bool() ? 'M' : 'F';
      const n = personName(staffRng, sex);
      emailN++;
      g.staff.push({
        tenant_id: tid,
        id: nextId('stf', scope),
        school_id: school.id,
        staff_no: `${school.code}/S/${String(g.staff.length + 1).padStart(3, '0')}`,
        first_name: n.first,
        last_name: n.last,
        roles,
        email: slugEmail(n.first, n.last, domain, emailN),
        phone: phone(staffRng),
        is_active: true,
      });
    }

    const currentClasses = schoolClasses.filter((c) => c.academic_year_id === currentYear.id);
    const teachers: Staff[] = [];
    for (let i = 0; i < currentClasses.length + 2; i++) {
      const sex = staffRng.bool() ? 'M' : 'F';
      const n = personName(staffRng, sex);
      emailN++;
      const t: Staff = {
        tenant_id: tid,
        id: nextId('stf', scope),
        school_id: school.id,
        staff_no: `${school.code}/S/${String(g.staff.length + 1).padStart(3, '0')}`,
        first_name: n.first,
        last_name: n.last,
        roles: ['teacher'],
        email: slugEmail(n.first, n.last, domain, emailN),
        phone: phone(staffRng),
        is_active: true,
      };
      g.staff.push(t);
      teachers.push(t);
    }

    // Class teachers and teaching assignments, for every year so prior-year
    // results have an author.
    for (const cls of schoolClasses) {
      const idx = schoolClasses.indexOf(cls) % teachers.length;
      cls.class_teacher_id = teachers[idx].id;
      for (const subj of subjectsForClass(g, cls)) {
        const teacher = teachers[(idx + subj.name.length) % teachers.length];
        g.teaching_assignments.push({
          tenant_id: tid,
          id: nextId('tas', scope),
          staff_id: teacher.id,
          class_id: cls.id,
          subject_id: subj.id,
          academic_year_id: cls.academic_year_id,
        });
      }
    }

    /* ------------------------------------------------------ guardians */
    // Pool sized below headcount so siblings arise naturally rather than being
    // bolted on. A one-guardian-per-student fixture never exercises the
    // "same guardian, two invoices, one payment" path that real bursars hit
    // every week.
    const targetStudents = Math.round(currentClasses.length * p.studentsPerClass * spec.sizeFactor);
    const guardianPool: Guardian[] = [];
    for (let i = 0; i < Math.max(3, Math.round(targetStudents * 0.72)); i++) {
      const sex = guardianRng.bool() ? 'M' : 'F';
      const n = personName(guardianRng, sex);
      guardianPool.push({
        tenant_id: tid,
        id: nextId('gdn', scope),
        first_name: n.first,
        last_name: n.last,
        phone: phone(guardianRng),
        alt_phone: guardianRng.bool(0.3) ? phone(guardianRng) : null,
        email: guardianRng.bool(0.4) ? slugEmail(n.first, n.last, 'gmail.com', ++emailN) : null,
        occupation: guardianRng.pick(OCCUPATIONS),
        national_id_last4: String(guardianRng.int(1000, 10000)),
      });
    }
    g.guardians.push(...guardianPool);

    /* ------------------------------------------------------- students */
    let guardianCursor = 0;
    const perClass = Math.max(4, Math.round(p.studentsPerClass * spec.sizeFactor));

    for (const cls of currentClasses) {
      const level = CLASS_LADDER.find((l) => {
        const lvl = g.class_levels.find((x) => x.id === cls.class_level_id)!;
        return l.name === lvl.name;
      })!;

      for (let i = 0; i < perClass; i++) {
        const sex: 'M' | 'F' = studentRng.bool(0.51) ? 'F' : 'M';
        const n = personName(studentRng, sex);
        const birthYear = Number(currentYear.label.slice(0, 4)) - level.typicalAge + studentRng.int(-1, 2);
        const dob = `${birthYear}-${String(studentRng.int(1, 13)).padStart(2, '0')}-${String(studentRng.int(1, 29)).padStart(2, '0')}`;
        const admittedYearsAgo = studentRng.weighted([0, 1, 2, 3], [0.18, 0.32, 0.28, 0.22]);
        const admittedOn = addDays(currentYear.starts_on, -365 * admittedYearsAgo + studentRng.int(0, 30));

        const student: Student = {
          tenant_id: tid,
          id: nextId('stu', scope),
          school_id: school.id,
          admission_no: `${school.code}/${admittedOn.slice(0, 4)}/${String(g.students.length + 1).padStart(4, '0')}`,
          first_name: n.first,
          middle_name: n.middle,
          last_name: n.last,
          sex,
          date_of_birth: dob,
          admitted_on: admittedOn,
          status: 'active',
          has_restricted_health_record: false,
        };
        g.students.push(student);

        g.enrolments.push({
          tenant_id: tid,
          id: nextId('enr', scope),
          student_id: student.id,
          class_id: cls.id,
          academic_year_id: currentYear.id,
          campus_id: cls.campus_id,
          started_on: currentYear.starts_on,
          ended_on: null,
          end_reason: null,
          is_current: true,
        });

        // Prior-year enrolment for returning students, one level down where
        // that level exists. This is what promotion reporting reads.
        if (admittedYearsAgo >= 1 && priorYear.id !== currentYear.id) {
          const lvl = g.class_levels.find((x) => x.id === cls.class_level_id)!;
          const lowerLvl = g.class_levels.find(
            (x) => x.sequence === lvl.sequence - 1 && g.divisions.some((d) => d.id === x.division_id && d.school_id === school.id),
          );
          const priorClass = lowerLvl
            ? schoolClasses.find((c) => c.academic_year_id === priorYear.id && c.class_level_id === lowerLvl.id && c.campus_id === cls.campus_id)
            : undefined;
          if (priorClass) {
            g.enrolments.push({
              tenant_id: tid,
              id: nextId('enr', scope),
              student_id: student.id,
              class_id: priorClass.id,
              academic_year_id: priorYear.id,
              campus_id: priorClass.campus_id,
              started_on: priorYear.starts_on,
              ended_on: priorYear.ends_on,
              end_reason: 'promotion',
              is_current: false,
            });
          }
        }

        // Guardian linking. Sequential cursor with occasional reuse produces a
        // stable sibling distribution.
        const primary = guardianPool[guardianCursor % guardianPool.length];
        if (!guardianRng.bool(0.28)) guardianCursor++;

        g.guardian_links.push({
          tenant_id: tid,
          id: nextId('gln', scope),
          guardian_id: primary.id,
          student_id: student.id,
          relationship: guardianRng.weighted(
            ['mother', 'father', 'grandparent', 'aunt', 'uncle', 'guardian'] as const,
            [0.46, 0.34, 0.09, 0.05, 0.03, 0.03],
          ),
          is_primary: true,
          is_fee_payer: true,
          receives_communication: true,
          probe: null,
        });
      }
    }

    /* ------------------------------------------- deterministic edge cases */
    const schoolStudents = g.students.filter((s) => s.school_id === school.id);

    // 1. A guardian with three children, guaranteed, not left to chance.
    if (schoolStudents.length >= 3 && guardianPool.length > 0) {
      const trio = guardianPool[0];
      for (const st of schoolStudents.slice(0, 3)) {
        const existing = g.guardian_links.find((l) => l.student_id === st.id && l.is_primary);
        if (existing) existing.guardian_id = trio.id;
      }
    }

    // 2. The FR-STU-020 cardinality probe: one student with a second guardian.
    //    Emitted only under many_to_many. If the schema enforces one-to-many,
    //    loading this fixture must fail on a unique constraint — that failure
    //    is the point, and is asserted in invariants.ts.
    if (cfg.guardianCardinality === 'many_to_many' && schoolStudents.length >= 4) {
      const target = schoolStudents[3];
      const primaryLink = g.guardian_links.find((l) => l.student_id === target.id && l.is_primary);
      // Must be a DIFFERENT guardian. Linking the same guardian twice would
      // trip a unique (guardian_id, student_id) constraint for a reason that
      // has nothing to do with the cardinality question being tested, and the
      // failure would be misread as evidence about FR-STU-020.
      const second = guardianPool.find((x) => x.id !== primaryLink?.guardian_id);
      if (second) {
        g.guardian_links.push({
          tenant_id: tid,
          id: nextId('gln', scope),
          guardian_id: second.id,
          student_id: target.id,
          relationship: 'father',
          is_primary: false,
          is_fee_payer: false,
          receives_communication: true,
          probe: 'guardian_cardinality',
        });
      }
    }

    // 3. Mid-term inbound transfer: admitted after the current term started, so
    //    invoicing must prorate rather than bill a full term.
    if (schoolStudents.length >= 6) {
      const joiner = schoolStudents[4];
      const activeTerm = g.terms.find(
        (t) => t.state === 'active' && g.academic_years.some((y) => y.id === t.academic_year_id && y.school_id === school.id),
      );
      if (activeTerm) {
        joiner.admitted_on = addDays(activeTerm.starts_on, 19);
        const enr = g.enrolments.find((e) => e.student_id === joiner.id && e.is_current);
        if (enr) enr.started_on = joiner.admitted_on;
        // A mid-term joiner has no prior-year history here.
        const priorEnr = g.enrolments.findIndex((e) => e.student_id === joiner.id && !e.is_current);
        if (priorEnr >= 0) g.enrolments.splice(priorEnr, 1);
      }
    }

    // 4. Outbound transfer mid-year, with an outstanding balance left behind.
    if (schoolStudents.length >= 8) {
      const leaver = schoolStudents[5];
      leaver.status = 'transferred_out';
      const enr = g.enrolments.find((e) => e.student_id === leaver.id && e.is_current);
      if (enr) {
        enr.ended_on = addDays(cfg.asOf, -26);
        enr.end_reason = 'transfer_out';
        enr.is_current = false;
      }
    }

    // 5. Campus transfer, multi-campus tenants only. Two enrolment rows, same
    //    year, different campus — the case a naive "one enrolment per year"
    //    unique index gets wrong.
    if (schoolCampuses.length > 1 && schoolStudents.length >= 10) {
      const mover = schoolStudents[6];
      const from = g.enrolments.find((e) => e.student_id === mover.id && e.is_current);
      const toClass = currentClasses.find(
        (c) => c.campus_id !== from?.campus_id && c.class_level_id === g.classes.find((x) => x.id === from?.class_id)?.class_level_id,
      );
      if (from && toClass) {
        from.ended_on = addDays(cfg.asOf, -40);
        from.end_reason = 'transfer_campus';
        from.is_current = false;
        g.enrolments.push({
          tenant_id: tid,
          id: nextId('enr', scope),
          student_id: mover.id,
          class_id: toClass.id,
          academic_year_id: currentYear.id,
          campus_id: toClass.campus_id,
          started_on: addDays(cfg.asOf, -39),
          ended_on: null,
          end_reason: null,
          is_current: true,
        });
      }
    }

    // 6. One restricted health record per school, so the role-visibility tests
    //    in §10 of the frontend spec have a subject that must NOT appear for an
    //    accountant or a class teacher.
    if (schoolStudents.length >= 3) {
      schoolStudents[2].has_restricted_health_record = true;
    }
  }
}

export interface RosterIndex {
  byClass: Map<string, Enrolment[]>;
  studentById: Map<string, Student>;
}

/**
 * Built once per tenant and passed down. Without it the roster lookup is
 * O(enrolments) per class per day, which turns the volume profile from seconds
 * into minutes and makes the generator too slow to run in CI — at which point
 * nobody runs it.
 */
export function buildRosterIndex(g: TenantGraph): RosterIndex {
  const byClass = new Map<string, Enrolment[]>();
  for (const e of g.enrolments) {
    const list = byClass.get(e.class_id);
    if (list) list.push(e);
    else byClass.set(e.class_id, [e]);
  }
  const studentById = new Map(g.students.map((s) => [s.id, s]));
  return { byClass, studentById };
}

/** Students actively enrolled in a class as of a date. */
export function rosterOf(g: TenantGraph, cls: SchoolClass, onDate: string, idx?: RosterIndex): Student[] {
  const index = idx ?? buildRosterIndex(g);
  const enrolments = index.byClass.get(cls.id) ?? [];
  const out: Student[] = [];
  for (const e of enrolments) {
    if (e.started_on > onDate) continue;
    if (e.ended_on !== null && e.ended_on < onDate) continue;
    const s = index.studentById.get(e.student_id);
    if (s) out.push(s);
  }
  return out;
}

export function teachersOf(g: TenantGraph, cls: SchoolClass): Staff[] {
  const school = schoolOfClass(g, cls);
  return g.staff.filter((s) => s.school_id === school.id && s.roles.includes('teacher'));
}
