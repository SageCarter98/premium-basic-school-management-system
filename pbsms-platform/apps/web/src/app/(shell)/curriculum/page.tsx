'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { RestrictedState } from '@/components/states/RestrictedState';
import { apiFetch, apiGet } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { ACADEMIC_ADMIN, ACADEMIC_STAFF, hasAnyRole } from '@/lib/role-groups';
import styles from '@/styles/tab-hub.module.css';

interface Student {
  id: string;
  first_name: string;
  last_name: string;
}
interface SchoolClass {
  id: string;
  name: string;
  academic_year_id: string;
}
interface AcademicYear {
  id: string;
  name: string;
}
interface Subject {
  id: string;
  name: string;
}
interface School {
  id: string;
  name: string;
}

interface SchoolAcademicSettings {
  school_id: string;
  uses_nacca_curriculum: boolean;
}
interface CurriculumStrand {
  id: string;
  subject_id: string;
  name: string;
  code: string;
}
interface CurriculumSubStrand {
  id: string;
  strand_id: string;
  name: string;
  code: string;
}
interface CurriculumIndicator {
  id: string;
  sub_strand_id: string;
  content_standard_code: string | null;
  content_standard_text: string | null;
  indicator_code: string;
  indicator_text: string;
}
interface CoverageRow {
  indicatorId: string;
  indicatorCode: string;
  indicatorText: string;
  assessed: boolean;
}
interface CompetencyProfileRow {
  indicatorId: string;
  indicatorCode: string;
  indicatorText: string;
  scored: boolean;
  passed: boolean | null;
}
interface BeceCandidate {
  id: string;
  student_id: string;
  academic_year_id: string;
  index_number: string;
  registration_status: string;
}
interface BeceMockResult {
  id: string;
  bece_candidate_id: string;
  exam_session: string;
  subject_name: string;
  grade: number;
  score_percentage: string | null;
}
interface ReadinessRow {
  subjectName: string;
  studentGrade: number | null;
  classAverageGrade: number | null;
  delta: number | null;
}
interface CsspsPlacement {
  id: string;
  student_id: string;
  choices: string[];
  placement_outcome: string | null;
  placement_confirmed_at: string | null;
}
interface CensusRow {
  className: string;
  gender: string;
  status: string;
  count: number;
}
interface AttendanceReturnRow {
  className: string;
  presentCount: number;
  totalCount: number;
  attendanceRate: number;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = body?.message;
  return (Array.isArray(m) ? m.join('; ') : m) ?? fallback;
}

function studentName(students: Student[], id: string): string {
  const s = students.find((st) => st.id === id);
  return s ? `${s.last_name}, ${s.first_name}` : id.slice(0, 8) + '…';
}

const TABS = ['Curriculum Mapping', 'BECE', 'Exit Reporting'] as const;
type Tab = (typeof TABS)[number];

/**
 * SRS Chapter 41 / spec §7.14 (NaCCA curriculum, BECE, GES, CSSPS). The
 * largest single piece of Stage 8 (~22 backend routes across 4 real
 * sub-domains) — grouped into 3 tabs rather than one-per-sub-domain,
 * since GES and CSSPS are individually thin (2 read-only report queries;
 * one small recording form). None of this is a real exam-board/ministry
 * integration: BECE index numbers are an internal convention (not real
 * WAEC format), GES reports are live DB queries rendered as tables (no
 * generated statutory file — a real export would be a frontend CSV
 * download, unbuilt here), and CSSPS placement recording has no real
 * CSSPS system behind it. All informational, matching each service
 * file's own documented scope.
 */
export default function CurriculumPage() {
  const [tab, setTab] = useState<Tab>('Curriculum Mapping');
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canAccess = hasAnyRole(roleCodes, ACADEMIC_STAFF);
  const canConfigure = hasAnyRole(roleCodes, ACADEMIC_ADMIN);

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [schools, setSchools] = useState<School[]>([]);

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    Promise.all([
      apiGet<Student[]>('/v1/students'),
      apiGet<SchoolClass[]>('/v1/classes'),
      apiGet<AcademicYear[]>('/v1/academic-years'),
      apiGet<Subject[]>('/v1/assessment/subjects'),
      apiGet<School[]>('/v1/schools'),
    ]).then(([s, c, y, subj, sch]) => {
      setStudents(s);
      setClasses(c);
      setYears(y);
      setSubjects(subj);
      setSchools(sch);
      setLoading(false);
    });
  }, [canAccess]);

  if (!canAccess) {
    return (
      <Card>
        <RestrictedState message="Curriculum is available to teaching and administrative staff." />
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading curriculum" rows={4} />
      </Card>
    );
  }

  const shared = { students, classes, years, subjects, schools, canConfigure };

  return (
    <div>
      <div className={styles.tabBar} role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={[styles.tabBtn, tab === t ? styles.tabBtnActive : ''].filter(Boolean).join(' ')} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <Card style={{ padding: 'var(--pb-space-4)' }}>
        {tab === 'Curriculum Mapping' && <CurriculumMappingTab {...shared} />}
        {tab === 'BECE' && <BeceTab {...shared} />}
        {tab === 'Exit Reporting' && <ExitReportingTab {...shared} />}
      </Card>
    </div>
  );
}

interface SharedProps {
  students: Student[];
  classes: SchoolClass[];
  years: AcademicYear[];
  subjects: Subject[];
  schools: School[];
  canConfigure: boolean;
}

// ---------------------------------------------------------------------
// Curriculum Mapping
// ---------------------------------------------------------------------

function CurriculumMappingTab({ students, classes, years, subjects, schools, canConfigure }: SharedProps) {
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? '');
  const [settings, setSettings] = useState<SchoolAcademicSettings | null>(null);
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '');
  const [strands, setStrands] = useState<CurriculumStrand[]>([]);
  const [subStrandsByStrand, setSubStrandsByStrand] = useState<Record<string, CurriculumSubStrand[]>>({});
  const [indicatorsBySubStrand, setIndicatorsBySubStrand] = useState<Record<string, CurriculumIndicator[]>>({});
  const [expandedStrand, setExpandedStrand] = useState<string | null>(null);
  const [expandedSubStrand, setExpandedSubStrand] = useState<string | null>(null);
  const [strandForm, setStrandForm] = useState({ name: '', code: '' });
  const [subStrandForm, setSubStrandForm] = useState({ name: '', code: '' });
  const [indicatorForm, setIndicatorForm] = useState({ indicatorCode: '', indicatorText: '', contentStandardCode: '', contentStandardText: '' });
  const [error, setError] = useState<string | null>(null);

  const [coverageClassId, setCoverageClassId] = useState(classes[0]?.id ?? '');
  const [coverage, setCoverage] = useState<CoverageRow[] | null>(null);

  const [profileStudentId, setProfileStudentId] = useState(students[0]?.id ?? '');
  const [profile, setProfile] = useState<CompetencyProfileRow[] | null>(null);

  async function loadSettings(id: string) {
    if (!id) return;
    setSettings(await apiGet<SchoolAcademicSettings | null>(`/v1/nacca/academic-settings/${id}`));
  }
  useEffect(() => {
    if (schoolId) loadSettings(schoolId);
  }, [schoolId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleNacca() {
    setError(null);
    const res = await apiFetch('/v1/nacca/academic-settings', { method: 'POST', body: JSON.stringify({ schoolId, usesNaccaCurriculum: !(settings?.uses_nacca_curriculum ?? false) }) });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    loadSettings(schoolId);
  }

  async function loadStrands(subj: string) {
    if (!subj) return;
    setStrands(await apiGet<CurriculumStrand[]>(`/v1/nacca/strands?subjectId=${subj}`));
  }
  useEffect(() => {
    if (subjectId) loadStrands(subjectId);
  }, [subjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addStrand() {
    setError(null);
    const res = await apiFetch('/v1/nacca/strands', { method: 'POST', body: JSON.stringify({ subjectId, name: strandForm.name, code: strandForm.code }) });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setStrandForm({ name: '', code: '' });
    loadStrands(subjectId);
  }

  async function expandStrand(strandId: string) {
    if (expandedStrand === strandId) {
      setExpandedStrand(null);
      return;
    }
    setExpandedStrand(strandId);
    if (!subStrandsByStrand[strandId]) {
      const rows = await apiGet<CurriculumSubStrand[]>(`/v1/nacca/strands/${strandId}/sub-strands`);
      setSubStrandsByStrand((m) => ({ ...m, [strandId]: rows }));
    }
  }

  async function addSubStrand(strandId: string) {
    setError(null);
    const res = await apiFetch('/v1/nacca/sub-strands', { method: 'POST', body: JSON.stringify({ strandId, name: subStrandForm.name, code: subStrandForm.code }) });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setSubStrandForm({ name: '', code: '' });
    setSubStrandsByStrand((m) => ({ ...m, [strandId]: undefined as unknown as CurriculumSubStrand[] }));
    const rows = await apiGet<CurriculumSubStrand[]>(`/v1/nacca/strands/${strandId}/sub-strands`);
    setSubStrandsByStrand((m) => ({ ...m, [strandId]: rows }));
  }

  async function expandSubStrand(subStrandId: string) {
    if (expandedSubStrand === subStrandId) {
      setExpandedSubStrand(null);
      return;
    }
    setExpandedSubStrand(subStrandId);
    if (!indicatorsBySubStrand[subStrandId]) {
      const rows = await apiGet<CurriculumIndicator[]>(`/v1/nacca/sub-strands/${subStrandId}/indicators`);
      setIndicatorsBySubStrand((m) => ({ ...m, [subStrandId]: rows }));
    }
  }

  async function addIndicator(subStrandId: string) {
    setError(null);
    const res = await apiFetch('/v1/nacca/indicators', {
      method: 'POST',
      body: JSON.stringify({
        subStrandId,
        indicatorCode: indicatorForm.indicatorCode,
        indicatorText: indicatorForm.indicatorText,
        contentStandardCode: indicatorForm.contentStandardCode || undefined,
        contentStandardText: indicatorForm.contentStandardText || undefined,
      }),
    });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setIndicatorForm({ indicatorCode: '', indicatorText: '', contentStandardCode: '', contentStandardText: '' });
    const rows = await apiGet<CurriculumIndicator[]>(`/v1/nacca/sub-strands/${subStrandId}/indicators`);
    setIndicatorsBySubStrand((m) => ({ ...m, [subStrandId]: rows }));
  }

  async function loadCoverage() {
    if (!coverageClassId || !subjectId) return;
    const cls = classes.find((c) => c.id === coverageClassId);
    if (!cls) return;
    setCoverage(await apiGet<CoverageRow[]>(`/v1/nacca/coverage-report?classId=${coverageClassId}&subjectId=${subjectId}&academicYearId=${cls.academic_year_id}`));
  }

  async function loadProfile() {
    if (!profileStudentId || !subjectId || !years[0]) return;
    setProfile(await apiGet<CompetencyProfileRow[]>(`/v1/nacca/students/${profileStudentId}/competency-profile?subjectId=${subjectId}&academicYearId=${years[0].id}`));
  }

  return (
    <div>
      {canConfigure && (
        <div className={styles.detailSection}>
          <div className={styles.detailSectionTitle}>NaCCA adoption</div>
          <div className={styles.formRow}>
            <select className={styles.select} value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Button type="button" variant="secondary" onClick={toggleNacca}>
              {settings?.uses_nacca_curriculum ? 'Using NaCCA — switch off' : 'Not using NaCCA — switch on'}
            </Button>
          </div>
        </div>
      )}
      {error && <ErrorState message={error} />}

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Strand → sub-strand → indicator tree</div>
        <div className={styles.formRow}>
          <select className={styles.select} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {canConfigure && (
          <div className={styles.formRow}>
            <input className={styles.textInput} placeholder="New strand name" value={strandForm.name} onChange={(e) => setStrandForm({ ...strandForm, name: e.target.value })} />
            <input className={styles.textInput} placeholder="Code" value={strandForm.code} onChange={(e) => setStrandForm({ ...strandForm, code: e.target.value })} />
            <Button type="button" variant="secondary" onClick={addStrand} disabled={!strandForm.name || !strandForm.code}>
              Add strand
            </Button>
          </div>
        )}
        {strands.length === 0 ? (
          <EmptyState title="No strands yet" message="Add one for this subject." />
        ) : (
          strands.map((strand) => (
            <div key={strand.id} className={styles.tree}>
              <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => expandStrand(strand.id)}>
                <span>
                  {strand.code} — {strand.name}
                </span>
              </div>
              {expandedStrand === strand.id && (
                <div className={styles.tree}>
                  {canConfigure && (
                    <div className={styles.formRow}>
                      <input className={styles.textInput} placeholder="New sub-strand name" value={subStrandForm.name} onChange={(e) => setSubStrandForm({ ...subStrandForm, name: e.target.value })} />
                      <input className={styles.textInput} placeholder="Code" value={subStrandForm.code} onChange={(e) => setSubStrandForm({ ...subStrandForm, code: e.target.value })} />
                      <Button type="button" variant="secondary" onClick={() => addSubStrand(strand.id)} disabled={!subStrandForm.name || !subStrandForm.code}>
                        Add sub-strand
                      </Button>
                    </div>
                  )}
                  {(subStrandsByStrand[strand.id] ?? []).map((sub) => (
                    <div key={sub.id}>
                      <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => expandSubStrand(sub.id)}>
                        <span>
                          {sub.code} — {sub.name}
                        </span>
                      </div>
                      {expandedSubStrand === sub.id && (
                        <div className={styles.tree}>
                          {canConfigure && (
                            <div className={styles.formRow}>
                              <input className={styles.textInput} placeholder="Indicator code" value={indicatorForm.indicatorCode} onChange={(e) => setIndicatorForm({ ...indicatorForm, indicatorCode: e.target.value })} />
                              <input className={styles.textInput} placeholder="Indicator text" value={indicatorForm.indicatorText} onChange={(e) => setIndicatorForm({ ...indicatorForm, indicatorText: e.target.value })} />
                              <Button type="button" variant="secondary" onClick={() => addIndicator(sub.id)} disabled={!indicatorForm.indicatorCode || !indicatorForm.indicatorText}>
                                Add indicator
                              </Button>
                            </div>
                          )}
                          {(indicatorsBySubStrand[sub.id] ?? []).map((ind) => (
                            <div key={ind.id} className={styles.listRow}>
                              <span>
                                {ind.indicator_code} — {ind.indicator_text}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Coverage report</div>
        <div className={styles.formRow}>
          <select className={styles.select} value={coverageClassId} onChange={(e) => setCoverageClassId(e.target.value)}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={loadCoverage}>
            Load
          </Button>
        </div>
        {coverage && (coverage.length === 0 ? (
          <EmptyState title="No indicators to report on" message="Add indicators for this subject first." />
        ) : (
          coverage.map((c) => (
            <div key={c.indicatorId} className={styles.listRow}>
              <span>
                {c.indicatorCode} — {c.indicatorText}
              </span>
              <Pill variant={c.assessed ? 'success' : 'neutral'}>{c.assessed ? 'assessed' : 'not yet assessed'}</Pill>
            </div>
          ))
        ))}
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Competency profile (per student)</div>
        <div className={styles.formRow}>
          <select className={styles.select} value={profileStudentId} onChange={(e) => setProfileStudentId(e.target.value)}>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.last_name}, {s.first_name}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={loadProfile}>
            Load
          </Button>
        </div>
        {profile && (profile.length === 0 ? (
          <EmptyState title="No profile data" message="No indicators or scores match this student/subject/year yet." />
        ) : (
          profile.map((p) => (
            <div key={p.indicatorId} className={styles.listRow}>
              <span>
                {p.indicatorCode} — {p.indicatorText}
              </span>
              {!p.scored ? <Pill variant="neutral">not scored</Pill> : <Pill variant={p.passed ? 'success' : 'danger'}>{p.passed ? 'passed' : 'below 50%'}</Pill>}
            </div>
          ))
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// BECE
// ---------------------------------------------------------------------

function BeceTab({ students, years, canConfigure }: SharedProps) {
  const [academicYearId, setAcademicYearId] = useState(years[0]?.id ?? '');
  const [candidates, setCandidates] = useState<BeceCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [newStudentId, setNewStudentId] = useState(students[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [session, setSession] = useState('2027-may-june');
  const [results, setResults] = useState<BeceMockResult[]>([]);
  const [aggregate, setAggregate] = useState<{ subjectsGraded: number; bestSixAggregate: number | null } | null>(null);
  const [readiness, setReadiness] = useState<ReadinessRow[] | null>(null);
  const [resultForm, setResultForm] = useState({ subjectName: '', grade: '5', scorePercentage: '' });

  function reload() {
    if (!academicYearId) return;
    setLoading(true);
    apiGet<BeceCandidate[]>(`/v1/nacca/bece/candidates?academicYearId=${academicYearId}`)
      .then(setCandidates)
      .finally(() => setLoading(false));
  }
  useEffect(reload, [academicYearId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function registerCandidate() {
    setError(null);
    const res = await apiFetch('/v1/nacca/bece/candidates', { method: 'POST', body: JSON.stringify({ studentId: newStudentId, academicYearId }) });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    reload();
  }

  async function expand(candidateId: string) {
    if (expandedId === candidateId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(candidateId);
    await loadDetail(candidateId);
  }

  async function loadDetail(candidateId: string) {
    const [r, a, ready] = await Promise.all([
      apiGet<BeceMockResult[]>(`/v1/nacca/bece/candidates/${candidateId}/mock-results?examSession=${session}`),
      apiGet<{ subjectsGraded: number; bestSixAggregate: number | null }>(`/v1/nacca/bece/candidates/${candidateId}/aggregate?examSession=${session}`),
      apiGet<ReadinessRow[]>(`/v1/nacca/bece/candidates/${candidateId}/readiness?examSession=${session}`),
    ]);
    setResults(r);
    setAggregate(a);
    setReadiness(ready);
  }

  async function recordResult(candidateId: string) {
    setError(null);
    const res = await apiFetch('/v1/nacca/bece/mock-results', {
      method: 'POST',
      body: JSON.stringify({ beceCandidateId: candidateId, examSession: session, subjectName: resultForm.subjectName, grade: Number(resultForm.grade), scorePercentage: resultForm.scorePercentage ? Number(resultForm.scorePercentage) : undefined }),
    });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setResultForm({ subjectName: '', grade: '5', scorePercentage: '' });
    loadDetail(candidateId);
  }

  if (loading) return <LoadingState label="Loading BECE candidates" rows={3} />;

  return (
    <div>
      <p className={styles.hint}>
        Index numbers are an internal school-code/year/sequence convention, not the real WAEC format — informational recording only, no live exam-board integration.
      </p>
      <div className={styles.formRow}>
        <select className={styles.select} value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)}>
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
            </option>
          ))}
        </select>
        <input className={styles.textInput} placeholder="Exam session, e.g. 2027-may-june" value={session} onChange={(e) => setSession(e.target.value)} />
      </div>
      {canConfigure && (
        <div className={styles.formRow}>
          <select className={styles.select} value={newStudentId} onChange={(e) => setNewStudentId(e.target.value)}>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.last_name}, {s.first_name}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={registerCandidate}>
            Register candidate
          </Button>
        </div>
      )}
      {error && <ErrorState message={error} />}
      {candidates.length === 0 ? (
        <EmptyState title="No candidates registered yet" message="Register one above." />
      ) : (
        candidates.map((c) => (
          <div key={c.id}>
            <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => expand(c.id)}>
              <span>
                {studentName(students, c.student_id)} — {c.index_number}
              </span>
              <Pill variant="neutral">{c.registration_status}</Pill>
            </div>
            {expandedId === c.id && (
              <div className={styles.detailPanel}>
                <div className={styles.formRow}>
                  <input className={styles.textInput} placeholder="Subject" value={resultForm.subjectName} onChange={(e) => setResultForm({ ...resultForm, subjectName: e.target.value })} />
                  <select className={styles.select} value={resultForm.grade} onChange={(e) => setResultForm({ ...resultForm, grade: e.target.value })}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => (
                      <option key={g} value={g}>
                        Grade {g}
                      </option>
                    ))}
                  </select>
                  <input className={styles.textInput} type="number" min="0" max="100" placeholder="Score % (optional)" value={resultForm.scorePercentage} onChange={(e) => setResultForm({ ...resultForm, scorePercentage: e.target.value })} />
                  <Button type="button" variant="secondary" onClick={() => recordResult(c.id)} disabled={!resultForm.subjectName}>
                    Record
                  </Button>
                </div>
                {results.map((r) => (
                  <div key={r.id} className={styles.listRow}>
                    <span>{r.subject_name}</span>
                    <span>
                      Grade {r.grade}
                      {r.score_percentage && <> ({Number(r.score_percentage).toFixed(1)}%)</>}
                    </span>
                  </div>
                ))}
                {aggregate && (
                  <div className={styles.statRow} style={{ marginTop: 'var(--pb-space-3)' }}>
                    <div className={styles.statTile}>
                      <div className={styles.statTileValue}>{aggregate.bestSixAggregate ?? '—'}</div>
                      <div className={styles.statTileLabel}>Best-six aggregate ({aggregate.subjectsGraded} graded, lower is better)</div>
                    </div>
                  </div>
                )}
                {readiness && readiness.length > 0 && (
                  <div className={styles.detailSection}>
                    <div className={styles.detailSectionTitle}>Readiness vs. class peers</div>
                    {readiness.map((r) => (
                      <div key={r.subjectName} className={styles.listRow}>
                        <span>{r.subjectName}</span>
                        <span>
                          {r.studentGrade ?? '—'} vs class avg {r.classAverageGrade?.toFixed(1) ?? '—'}
                          {r.delta !== null && <> ({r.delta > 0 ? '+' : ''}{r.delta.toFixed(1)})</>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Exit Reporting (GES statutory queries + CSSPS placements)
// ---------------------------------------------------------------------

function ExitReportingTab({ students, classes, years, canConfigure }: SharedProps) {
  const [reportType, setReportType] = useState<'census' | 'attendance'>('census');
  const [academicYearId, setAcademicYearId] = useState(years[0]?.id ?? '');
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [census, setCensus] = useState<CensusRow[] | null>(null);
  const [attendance, setAttendance] = useState<AttendanceReturnRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const [placementStudentId, setPlacementStudentId] = useState(students[0]?.id ?? '');
  const [placement, setPlacement] = useState<CsspsPlacement | null>(null);
  const [choicesInput, setChoicesInput] = useState('');
  const [outcomeInput, setOutcomeInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function loadReport() {
    setLoading(true);
    if (reportType === 'census') {
      setCensus(await apiGet<CensusRow[]>(`/v1/nacca/ges/enrolment-census?academicYearId=${academicYearId}`));
    } else {
      setAttendance(await apiGet<AttendanceReturnRow[]>(`/v1/nacca/ges/attendance-returns?classId=${classId}&periodStart=${periodStart}&periodEnd=${periodEnd}`));
    }
    setLoading(false);
  }

  async function loadPlacement(id: string) {
    if (!id) return;
    const p = await apiGet<CsspsPlacement | null>(`/v1/nacca/cssps/placements/${id}`);
    setPlacement(p);
    setChoicesInput(p?.choices.join(', ') ?? '');
    setOutcomeInput(p?.placement_outcome ?? '');
  }
  useEffect(() => {
    if (placementStudentId) loadPlacement(placementStudentId);
  }, [placementStudentId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveChoices() {
    setError(null);
    const choices = choicesInput.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 6);
    const res = await apiFetch('/v1/nacca/cssps/placements', { method: 'POST', body: JSON.stringify({ studentId: placementStudentId, choices }) });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    loadPlacement(placementStudentId);
  }

  async function confirmPlacement() {
    if (!outcomeInput) return;
    setError(null);
    const res = await apiFetch(`/v1/nacca/cssps/placements/${placementStudentId}/confirm`, { method: 'POST', body: JSON.stringify({ placementOutcome: outcomeInput }) });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    loadPlacement(placementStudentId);
  }

  return (
    <div>
      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>GES statutory reports</div>
        <p className={styles.hint}>Live database queries rendered as a table — no generated statutory file exists server-side; use your browser&apos;s print/export for an actual file.</p>
        <div className={styles.formRow}>
          <select className={styles.select} value={reportType} onChange={(e) => setReportType(e.target.value as 'census' | 'attendance')}>
            <option value="census">Enrolment census</option>
            <option value="attendance">Attendance returns</option>
          </select>
          {reportType === 'census' ? (
            <select className={styles.select} value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)}>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <select className={styles.select} value={classId} onChange={(e) => setClassId(e.target.value)}>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input className={styles.textInput} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              <input className={styles.textInput} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </>
          )}
          <Button type="button" variant="secondary" onClick={loadReport} disabled={reportType === 'attendance' && (!periodStart || !periodEnd)}>
            Run report
          </Button>
        </div>
        {loading ? (
          <LoadingState label="Loading report" rows={3} />
        ) : reportType === 'census' && census ? (
          census.length === 0 ? (
            <EmptyState title="No data" message="No enrolments match this academic year." />
          ) : (
            census.map((r, idx) => (
              <div key={idx} className={styles.listRow}>
                <span>
                  {r.className} — {r.gender} · {r.status}
                </span>
                <span>{r.count}</span>
              </div>
            ))
          )
        ) : reportType === 'attendance' && attendance ? (
          attendance.length === 0 ? (
            <EmptyState title="No data" message="No attendance records match this period." />
          ) : (
            attendance.map((r, idx) => (
              <div key={idx} className={styles.listRow}>
                <span>{r.className}</span>
                <span>
                  {r.presentCount}/{r.totalCount} ({(r.attendanceRate * 100).toFixed(0)}%)
                </span>
              </div>
            ))
          )
        ) : null}
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>CSSPS choices &amp; placement (JHS exit)</div>
        <p className={styles.hint}>Informational recording only — no real CSSPS system integration exists.</p>
        <div className={styles.formRow}>
          <select className={styles.select} value={placementStudentId} onChange={(e) => setPlacementStudentId(e.target.value)}>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.last_name}, {s.first_name}
              </option>
            ))}
          </select>
        </div>
        {canConfigure && (
          <>
            <div className={styles.formRow}>
              <input className={styles.textInput} placeholder="Up to 6 school choices, comma-separated" value={choicesInput} onChange={(e) => setChoicesInput(e.target.value)} />
              <Button type="button" variant="secondary" onClick={saveChoices} disabled={!choicesInput}>
                Save choices
              </Button>
            </div>
            <div className={styles.formRow}>
              <input className={styles.textInput} placeholder="Placement outcome" value={outcomeInput} onChange={(e) => setOutcomeInput(e.target.value)} />
              <Button type="button" onClick={confirmPlacement} disabled={!placement || !outcomeInput}>
                Confirm placement
              </Button>
            </div>
          </>
        )}
        {error && <ErrorState message={error} />}
        {placement ? (
          <div className={styles.listRow}>
            <span>Choices: {placement.choices.join(', ') || '—'}</span>
            {placement.placement_confirmed_at ? <Pill variant="success">confirmed: {placement.placement_outcome}</Pill> : <Pill variant="neutral">not yet confirmed</Pill>}
          </div>
        ) : (
          <EmptyState title="No CSSPS record yet" message="Save choices above to start one." />
        )}
      </div>
    </div>
  );
}
