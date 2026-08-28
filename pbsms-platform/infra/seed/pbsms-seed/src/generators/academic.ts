import { CALENDARS, PROFILES, YEAR_LABELS, type SeedConfig, type TenantSpec } from '../config.js';
import { CLASS_LADDER, DISTRICTS, SUBJECTS } from '../corpus.js';
import { addDays, nextId, type Rng } from '../rng.js';
import type {
  AcademicYear, Campus, ClassLevel, Division, SchoolClass, School, Subject, TenantGraph, Term, TermState, YearState,
} from '../types.js';

const STREAMS = ['A', 'B', 'C', 'D'];

function stateFor(starts: string, ends: string, asOf: string): YearState & TermState {
  if (ends < asOf) return 'closed';
  if (starts > asOf) return 'planned';
  return 'active';
}

export function generateAcademic(g: TenantGraph, spec: TenantSpec, cfg: SeedConfig, rng: Rng): void {
  const p = PROFILES[cfg.profile];
  const tid = g.tenant.id;
  const scope = spec.slug;

  const ladder = CLASS_LADDER.slice(Math.max(0, CLASS_LADDER.length - p.levelsFromTop));

  for (const s of spec.schools) {
    const district = DISTRICTS[s.districtIndex % DISTRICTS.length];
    const school: School = {
      tenant_id: tid,
      id: nextId('sch', scope),
      name: s.name,
      code: s.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 5),
      district: district.district,
      ownership: s.ownership,
      locality: s.locality,
    };
    g.schools.push(school);

    for (const [i, cname] of s.campuses.entries()) {
      g.campuses.push({
        tenant_id: tid,
        id: nextId('cmp', scope),
        school_id: school.id,
        name: cname,
        is_primary: i === 0,
      });
    }
    const campuses = g.campuses.filter((c) => c.school_id === school.id);

    // Divisions and levels, per school.
    const divisionNames = [...new Set(ladder.map((l) => l.division))];
    const divisionByName = new Map<string, Division>();
    for (const [i, name] of divisionNames.entries()) {
      const d: Division = {
        tenant_id: tid,
        id: nextId('div', scope),
        school_id: school.id,
        name: name as Division['name'],
        sequence: i + 1,
      };
      g.divisions.push(d);
      divisionByName.set(name, d);
    }

    const levelByName = new Map<string, ClassLevel>();
    for (const l of ladder) {
      const lvl: ClassLevel = {
        tenant_id: tid,
        id: nextId('lvl', scope),
        division_id: divisionByName.get(l.division)!.id,
        name: l.name,
        sequence: l.sequence,
      };
      g.class_levels.push(lvl);
      levelByName.set(l.name, lvl);
    }

    // Subjects, filtered to the divisions this school actually runs.
    for (const s2 of SUBJECTS) {
      const divIds = s2.divisions.map((d) => divisionByName.get(d)?.id).filter((x): x is string => !!x);
      if (divIds.length === 0) continue;
      g.subjects.push({
        tenant_id: tid,
        id: nextId('sub', scope),
        school_id: school.id,
        name: s2.name,
        code: s2.code,
        division_ids: divIds,
        is_core: s2.core,
        nacca_strand_count: s2.strands,
      });
    }

    // Years, terms, classes.
    for (const label of YEAR_LABELS) {
      const cal = CALENDARS[label];
      const yearState = stateFor(cal.starts, cal.ends, cfg.asOf);
      const year: AcademicYear = {
        tenant_id: tid,
        id: nextId('yr', scope),
        school_id: school.id,
        label,
        starts_on: cal.starts,
        ends_on: cal.ends,
        state: yearState,
      };
      g.academic_years.push(year);

      for (const t of cal.terms) {
        const termState = stateFor(t.starts, t.ends, cfg.asOf);
        const term: Term = {
          tenant_id: tid,
          id: nextId('trm', scope),
          academic_year_id: year.id,
          sequence: t.seq,
          name: t.name,
          starts_on: t.starts,
          ends_on: t.ends,
          state: termState,
          score_entry_opens_on: addDays(t.ends, -21),
          score_entry_closes_on: addDays(t.ends, 7),
        };
        g.terms.push(term);
      }

      // One class per level per stream per campus.
      const streams = STREAMS.slice(0, p.streamsPerLevel);
      for (const campus of campuses) {
        for (const l of ladder) {
          const lvl = levelByName.get(l.name)!;
          for (const st of streams) {
            const cls: SchoolClass = {
              tenant_id: tid,
              id: nextId('cls', scope),
              campus_id: campus.id,
              class_level_id: lvl.id,
              academic_year_id: year.id,
              name: `${l.name}${st}`,
              stream: st,
              class_teacher_id: null, // back-filled once staff exist
              capacity: Math.round(p.studentsPerClass * 1.3),
            };
            g.classes.push(cls);
          }
        }
      }
    }
  }
}

/** Subjects a given class level should be taught, resolved through its division. */
export function subjectsForClass(g: TenantGraph, cls: SchoolClass): Subject[] {
  const lvl = g.class_levels.find((l) => l.id === cls.class_level_id)!;
  return g.subjects.filter((s) => s.division_ids.includes(lvl.division_id));
}

export function schoolOfClass(g: TenantGraph, cls: SchoolClass): School {
  const campus = g.campuses.find((c) => c.id === cls.campus_id)!;
  return g.schools.find((s) => s.id === campus.school_id)!;
}
