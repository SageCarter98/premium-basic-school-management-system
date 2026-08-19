/**
 * attendance-roster.ts — Stage 3's pre-fetch + client-side join (spec
 * §9.1). None of `/v1/classes`, `/v1/enrolments`, `/v1/students` accept a
 * `classId`/`academicYearId` filter server-side yet (checked before
 * writing this — every findAll() in apps/api is a plain unfiltered list,
 * same as attendance's own findAll()), so "this teacher's roster for this
 * class" is built by fetching the small tenant-wide lists and joining them
 * here. Fine at seed-data scale; a real deployment would want a filtered
 * `/v1/enrolments?classId=&academicYearId=` endpoint — flagged in
 * apps/web/README.md's Stage 3 section, not silently worked around.
 */

import { apiGet } from './api-client';
import { cacheRosterData, getCachedRosterData } from './offline-db';

export interface TeacherAssignment {
  id: string;
  teacher_id: string;
  class_id: string;
  subject_id: string;
  academic_year_id: string;
  status: string;
}

export interface SchoolClass {
  id: string;
  academic_year_id: string;
  name: string;
  level: string;
}

export interface Enrolment {
  id: string;
  student_id: string;
  academic_year_id: string;
  class_id: string;
  status: string;
}

export interface Student {
  id: string;
  first_name: string;
  last_name: string;
}

export interface RosterData {
  assignments: TeacherAssignment[];
  classes: SchoolClass[];
  enrolments: Enrolment[];
  students: Student[];
}

async function fetchOrCache<T>(tenantId: string, key: string, path: string): Promise<T> {
  try {
    const data = await apiGet<T>(path);
    await cacheRosterData(tenantId, key, data);
    return data;
  } catch (err) {
    const cached = await getCachedRosterData<T>(tenantId, key);
    if (cached) return cached;
    throw err;
  }
}

/** Spec §9.1 "Pre-fetch": called on any successful connection. Falls back
 * to whatever was cached on a previous successful connection when the
 * network call itself fails (offline, timeout) — this is what lets the
 * register screen "open with data even in airplane mode" (spec §8.1). */
export async function loadRosterData(tenantId: string, teacherId: string): Promise<RosterData> {
  const [assignments, classes, enrolments, students] = await Promise.all([
    fetchOrCache<TeacherAssignment[]>(
      tenantId,
      'teacher-assignments',
      `/v1/teacher-assignments?teacherId=${encodeURIComponent(teacherId)}`,
    ),
    fetchOrCache<SchoolClass[]>(tenantId, 'classes', '/v1/classes'),
    fetchOrCache<Enrolment[]>(tenantId, 'enrolments', '/v1/enrolments'),
    fetchOrCache<Student[]>(tenantId, 'students', '/v1/students'),
  ]);
  return { assignments, classes, enrolments, students };
}

export interface ClassOption {
  classId: string;
  academicYearId: string;
  className: string;
}

export function activeClassOptions(data: RosterData): ClassOption[] {
  const seen = new Map<string, ClassOption>();
  data.assignments
    .filter((a) => a.status === 'active')
    .forEach((a) => {
      const key = `${a.class_id}:${a.academic_year_id}`;
      if (seen.has(key)) return;
      const cls = data.classes.find((c) => c.id === a.class_id);
      seen.set(key, { classId: a.class_id, academicYearId: a.academic_year_id, className: cls?.name ?? a.class_id });
    });
  return Array.from(seen.values());
}

export interface RosterStudent {
  studentId: string;
  name: string;
}

export function rosterForClass(data: RosterData, classId: string, academicYearId: string): RosterStudent[] {
  const studentIds = data.enrolments
    .filter((e) => e.class_id === classId && e.academic_year_id === academicYearId && e.status === 'active')
    .map((e) => e.student_id);
  return studentIds
    .map((id) => data.students.find((s) => s.id === id))
    .filter((s): s is Student => Boolean(s))
    .map((s) => ({ studentId: s.id, name: `${s.last_name}, ${s.first_name}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
