/**
 * assessment-roster.ts — Stage 4's pre-fetch helpers for the Score Entry
 * screen and Today home's "Enter scores" tile (spec §8.11). Same
 * client-side-join posture as attendance-roster.ts and for the identical
 * reason: `/v1/assessment/structures` and `/v1/assessment/structures/:id/
 * components` are unfiltered `findAll()`s in apps/api, checked before
 * writing this. Pair this module's `AssessmentStructure`/`AssessmentComponent`
 * with attendance-roster.ts's `TeacherAssignment`/`SchoolClass`/
 * `rosterForClass` to build one screen — deliberately two focused modules
 * rather than one that re-declares the attendance-side types too.
 */

import { apiGet } from './api-client';
import { cacheRosterData, getCachedRosterData } from './offline-db';

export interface Subject {
  id: string;
  name: string;
  code: string;
}

export interface AssessmentStructure {
  id: string;
  class_id: string;
  subject_id: string;
  academic_year_id: string;
  status: string;
}

export interface AssessmentComponent {
  id: string;
  assessment_structure_id: string;
  component_type: string;
  weight: string;
  max_score: string;
}

export interface ScoreRow {
  id: string;
  assessment_component_id: string;
  student_id: string;
  value: string | null;
  status: string;
  missing_reason: string | null;
  version: number;
}

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  class_exercise: 'Class Exercise',
  homework: 'Homework',
  project: 'Project',
  mid_term: 'Mid-term',
  end_of_term_exam: 'End of Term Exam',
};

export function componentTypeLabel(type: string): string {
  return COMPONENT_TYPE_LABELS[type] ?? type;
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

export async function loadSubjects(tenantId: string): Promise<Subject[]> {
  return fetchOrCache<Subject[]>(tenantId, 'assessment-subjects', '/v1/assessment/subjects');
}

export async function loadStructures(tenantId: string): Promise<AssessmentStructure[]> {
  return fetchOrCache<AssessmentStructure[]>(tenantId, 'assessment-structures', '/v1/assessment/structures');
}

export async function loadComponents(tenantId: string, structureId: string): Promise<AssessmentComponent[]> {
  return fetchOrCache<AssessmentComponent[]>(
    tenantId,
    `assessment-components:${structureId}`,
    `/v1/assessment/structures/${structureId}/components`,
  );
}

export async function loadScores(tenantId: string, componentId: string): Promise<ScoreRow[]> {
  return fetchOrCache<ScoreRow[]>(tenantId, `assessment-scores:${componentId}`, `/v1/assessment/components/${componentId}/scores`);
}

/** A structure is score-enterable exactly while 'draft' (assessment.
 * service.ts's upsertScore() rejects anything else) — matched against one
 * class+subject+academicYear triple, the same shape teacher-assignments
 * already carries. */
export function findOpenStructure(
  structures: AssessmentStructure[],
  classId: string,
  subjectId: string,
  academicYearId: string,
): AssessmentStructure | null {
  return (
    structures.find(
      (s) => s.class_id === classId && s.subject_id === subjectId && s.academic_year_id === academicYearId && s.status === 'draft',
    ) ?? null
  );
}
