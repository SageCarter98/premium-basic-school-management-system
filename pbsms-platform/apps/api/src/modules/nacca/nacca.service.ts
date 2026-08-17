/**
 * nacca.service.ts
 *
 * Implements SRS v2.1 Chapter 41 (NaCCA, BECE, GES & CSSPS Alignment) —
 * Phase G, the last of the multi-phase completion plan. See
 * 0030_nacca_curriculum.sql's header for the full schema design and
 * every documented simplification (three curriculum levels not four,
 * generated not WAEC-issued index numbers, etc.).
 *
 * DOM-030 ("report cards... display a competency profile") is
 * deliberately NOT wired into documents.service.ts's generateReportCard()
 * — that function is already tested, working code, and Chapter 41's own
 * "MAY"/opt-in framing doesn't require it to live inside the existing
 * document-generation path specifically. competencyProfile() below is a
 * standalone read endpoint a caller (or a future frontend) composes with
 * the existing report card, rather than a change risked inside it.
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { UpsertAcademicSettingsDto } from './dto/upsert-academic-settings.dto';
import { CreateStrandDto } from './dto/create-strand.dto';
import { CreateSubStrandDto } from './dto/create-sub-strand.dto';
import { CreateIndicatorDto } from './dto/create-indicator.dto';
import { RegisterCandidateDto } from './dto/register-candidate.dto';
import { RecordMockResultDto } from './dto/record-mock-result.dto';
import { RecordCsspsPlacementDto } from './dto/record-cssps-placement.dto';

/** No numeric pass threshold is specified anywhere in Chapter 41's text
 * (NaCCA competency levels are typically qualitative — "developing" /
 * "proficient" / "highly proficient" — not a single pass/fail cut) — 50%
 * of the component's own configured max_score is a documented modeling
 * decision, the same category of judgment call as Chapter 4.1's
 * transition graph or Finance's role-tier split. */
const COMPETENCY_PASS_FRACTION = 0.5;

export interface SchoolAcademicSettings {
  id: string;
  tenant_id: string;
  school_id: string;
  uses_nacca_curriculum: boolean;
}

export interface CurriculumStrand {
  id: string;
  tenant_id: string;
  subject_id: string;
  name: string;
  code: string;
}

export interface CurriculumSubStrand {
  id: string;
  tenant_id: string;
  strand_id: string;
  name: string;
  code: string;
}

export interface CurriculumIndicator {
  id: string;
  tenant_id: string;
  sub_strand_id: string;
  content_standard_code: string | null;
  content_standard_text: string | null;
  indicator_code: string;
  indicator_text: string;
}

export interface CoverageRow {
  indicatorId: string;
  indicatorCode: string;
  indicatorText: string;
  assessed: boolean;
}

export interface CompetencyProfileRow {
  indicatorId: string;
  indicatorCode: string;
  indicatorText: string;
  scored: boolean;
  passed: boolean | null;
}

export interface BeceCandidate {
  id: string;
  tenant_id: string;
  student_id: string;
  academic_year_id: string;
  index_number: string;
  registration_status: string;
}

export interface BeceMockResult {
  id: string;
  tenant_id: string;
  bece_candidate_id: string;
  exam_session: string;
  subject_name: string;
  grade: number;
  score_percentage: string | null;
}

export interface ReadinessRow {
  subjectName: string;
  studentGrade: number | null;
  classAverageGrade: number | null;
  delta: number | null;
}

export interface CsspsPlacement {
  id: string;
  tenant_id: string;
  student_id: string;
  choices: string[];
  placement_outcome: string | null;
  placement_confirmed_at: string | null;
}

@Injectable()
export class NaccaService {
  constructor(private readonly db: TenantDatabaseService) {}

  // --------------------------------------------------------------------
  // 41.1 School opt-in + curriculum structure (DOM-010/020)
  // --------------------------------------------------------------------

  async upsertAcademicSettings(input: UpsertAcademicSettingsDto): Promise<SchoolAcademicSettings> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<SchoolAcademicSettings>(
      `insert into school_academic_settings (tenant_id, school_id, uses_nacca_curriculum, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $3)
       on conflict (tenant_id, school_id)
       do update set uses_nacca_curriculum = $2, updated_at = now(), updated_by = $3
       returning *`,
      [input.schoolId, input.usesNaccaCurriculum, userId],
    );
    return rows[0];
  }

  async findAcademicSettings(schoolId: string): Promise<SchoolAcademicSettings | null> {
    const rows = await this.db.query<SchoolAcademicSettings>(
      `select * from school_academic_settings where school_id = $1`,
      [schoolId],
    );
    return rows[0] ?? null;
  }

  async createStrand(input: CreateStrandDto): Promise<CurriculumStrand> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<CurriculumStrand>(
      `insert into curriculum_strands (tenant_id, subject_id, name, code, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $4)
       returning *`,
      [input.subjectId, input.name, input.code, userId],
    );
    return rows[0];
  }

  async findStrands(subjectId?: string): Promise<CurriculumStrand[]> {
    return this.db.query<CurriculumStrand>(
      `select * from curriculum_strands where $1::uuid is null or subject_id = $1 order by code`,
      [subjectId ?? null],
    );
  }

  async createSubStrand(input: CreateSubStrandDto): Promise<CurriculumSubStrand> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<CurriculumSubStrand>(
      `insert into curriculum_sub_strands (tenant_id, strand_id, name, code, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $4)
       returning *`,
      [input.strandId, input.name, input.code, userId],
    );
    return rows[0];
  }

  async findSubStrands(strandId: string): Promise<CurriculumSubStrand[]> {
    return this.db.query<CurriculumSubStrand>(`select * from curriculum_sub_strands where strand_id = $1 order by code`, [
      strandId,
    ]);
  }

  async createIndicator(input: CreateIndicatorDto): Promise<CurriculumIndicator> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<CurriculumIndicator>(
      `insert into curriculum_indicators
         (tenant_id, sub_strand_id, content_standard_code, content_standard_text, indicator_code, indicator_text, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $6)
       returning *`,
      [input.subStrandId, input.contentStandardCode ?? null, input.contentStandardText ?? null, input.indicatorCode, input.indicatorText, userId],
    );
    return rows[0];
  }

  async findIndicators(subStrandId: string): Promise<CurriculumIndicator[]> {
    return this.db.query<CurriculumIndicator>(
      `select * from curriculum_indicators where sub_strand_id = $1 order by indicator_code`,
      [subStrandId],
    );
  }

  /** DOM-020: "which indicators have been assessed, which have not" for a
   * class+subject+year — an indicator counts as assessed once at least
   * one score has actually been entered (status='scored') against a
   * component tagged to it, not merely once a component exists. */
  async coverageReport(classId: string, subjectId: string, academicYearId: string): Promise<CoverageRow[]> {
    return this.db.query<CoverageRow>(
      `select
         ci.id as "indicatorId",
         ci.indicator_code as "indicatorCode",
         ci.indicator_text as "indicatorText",
         exists (
           select 1 from assessment_components ac
           join assessment_structures ast on ast.id = ac.assessment_structure_id
           join scores sc on sc.assessment_component_id = ac.id
           where ac.indicator_id = ci.id
             and ast.class_id = $1 and ast.subject_id = $2 and ast.academic_year_id = $3
             and sc.status = 'scored'
         ) as assessed
       from curriculum_indicators ci
       join curriculum_sub_strands css on css.id = ci.sub_strand_id
       join curriculum_strands cs on cs.id = css.strand_id
       where cs.subject_id = $2
       order by ci.indicator_code`,
      [classId, subjectId, academicYearId],
    );
  }

  /** DOM-030's standalone data source — see this file's header for why it
   * isn't wired into generateReportCard() directly. */
  async competencyProfile(studentId: string, subjectId: string, academicYearId: string): Promise<CompetencyProfileRow[]> {
    return this.db.query<CompetencyProfileRow>(
      `select
         ci.id as "indicatorId",
         ci.indicator_code as "indicatorCode",
         ci.indicator_text as "indicatorText",
         (sc.id is not null and sc.status = 'scored') as scored,
         case when sc.status = 'scored' then sc.value >= (ac.max_score * ${COMPETENCY_PASS_FRACTION}) else null end as passed
       from curriculum_indicators ci
       join curriculum_sub_strands css on css.id = ci.sub_strand_id
       join curriculum_strands cs on cs.id = css.strand_id
       left join assessment_components ac on ac.indicator_id = ci.id
       left join assessment_structures ast on ast.id = ac.assessment_structure_id and ast.academic_year_id = $3
       left join scores sc on sc.assessment_component_id = ac.id and sc.student_id = $1
       where cs.subject_id = $2
       order by ci.indicator_code`,
      [studentId, subjectId, academicYearId],
    );
  }

  // --------------------------------------------------------------------
  // 41.2 BECE support (DOM-040/050/060)
  // --------------------------------------------------------------------

  /** DOM-040: index number generated as SCHOOLCODE-YEAR-SEQUENCE — an
   * internal convention, not the real WAEC-assigned format (this is
   * informational recording, same category as DOM-080's CSSPS choices,
   * not a live registration integration). */
  async registerCandidate(input: RegisterCandidateDto): Promise<BeceCandidate> {
    const { userId } = TenantContextStore.current();

    const studentRows = await this.db.query<{ school_code: string; year_name: string }>(
      `select sc.code as school_code, ay.name as year_name
       from students s
       join schools sc on sc.id = s.school_id
       join academic_years ay on ay.id = $2
       where s.id = $1`,
      [input.studentId, input.academicYearId],
    );
    if (studentRows.length === 0) {
      throw new NotFoundException(`Student ${input.studentId} or academic year ${input.academicYearId} not found`);
    }
    const { school_code, year_name } = studentRows[0];

    const sequenceRows = await this.db.query<{ count: string }>(
      `select count(*) as count from bece_candidates where academic_year_id = $1`,
      [input.academicYearId],
    );
    const sequence = Number(sequenceRows[0].count) + 1;
    const indexNumber = `${school_code}-${year_name.replace(/[^0-9A-Za-z]/g, '')}-${String(sequence).padStart(4, '0')}`;

    const rows = await this.db.query<BeceCandidate>(
      `insert into bece_candidates (tenant_id, student_id, academic_year_id, index_number, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $4)
       returning *`,
      [input.studentId, input.academicYearId, indexNumber, userId],
    );
    return rows[0];
  }

  async findCandidates(academicYearId?: string): Promise<BeceCandidate[]> {
    return this.db.query<BeceCandidate>(
      `select * from bece_candidates where $1::uuid is null or academic_year_id = $1 order by index_number`,
      [academicYearId ?? null],
    );
  }

  async findOneCandidate(id: string): Promise<BeceCandidate> {
    const rows = await this.db.query<BeceCandidate>(`select * from bece_candidates where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`BECE candidate ${id} not found`);
    }
    return rows[0];
  }

  async recordMockResult(input: RecordMockResultDto): Promise<BeceMockResult> {
    const { userId } = TenantContextStore.current();
    await this.findOneCandidate(input.beceCandidateId);
    const rows = await this.db.query<BeceMockResult>(
      `insert into bece_mock_results (tenant_id, bece_candidate_id, exam_session, subject_name, grade, score_percentage, created_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6)
       on conflict (tenant_id, bece_candidate_id, exam_session, subject_name)
       do update set grade = $4, score_percentage = $5
       returning *`,
      [input.beceCandidateId, input.examSession, input.subjectName, input.grade, input.scorePercentage ?? null, userId],
    );
    return rows[0];
  }

  async findMockResults(beceCandidateId: string, examSession: string): Promise<BeceMockResult[]> {
    return this.db.query<BeceMockResult>(
      `select * from bece_mock_results where bece_candidate_id = $1 and exam_session = $2 order by subject_name`,
      [beceCandidateId, examSession],
    );
  }

  /** DOM-050: "aggregate of best six" — BECE convention, LOWER is
   * better (best possible aggregate is 6, one grade-1 per subject). */
  async aggregate(beceCandidateId: string, examSession: string): Promise<{ subjectsGraded: number; bestSixAggregate: number | null }> {
    const results = await this.findMockResults(beceCandidateId, examSession);
    const grades = results.map((r) => r.grade).sort((a, b) => a - b);
    const bestSix = grades.slice(0, 6);
    return {
      subjectsGraded: results.length,
      bestSixAggregate: bestSix.length === 6 ? bestSix.reduce((sum, g) => sum + g, 0) : null,
    };
  }

  /** DOM-060: per-subject student grade vs. the class-of-candidates
   * average for the same exam session — "class level" strength/weakness,
   * scoped to candidates who share this student's current class via
   * their bece_candidates->students->enrolments chain. Bounded, real
   * comparison; a multi-year historical trend is Phase E's
   * trendsByStudent()'s job, not duplicated here. */
  async readinessAnalytics(beceCandidateId: string, examSession: string): Promise<ReadinessRow[]> {
    return this.db.query<ReadinessRow>(
      `with candidate_class as (
         select e.class_id from bece_candidates bc
         join students s on s.id = bc.student_id
         join enrolments e on e.student_id = s.id and e.academic_year_id = bc.academic_year_id
         where bc.id = $1
         limit 1
       ),
       peer_candidates as (
         select bc.id from bece_candidates bc
         join students s on s.id = bc.student_id
         join enrolments e on e.student_id = s.id and e.academic_year_id = bc.academic_year_id
         where e.class_id = (select class_id from candidate_class)
       )
       select
         subj.subject_name as "subjectName",
         mine.grade as "studentGrade",
         round(avg(peers.grade), 2) as "classAverageGrade",
         case when mine.grade is not null then round(avg(peers.grade) - mine.grade, 2) else null end as "delta"
       from (select distinct subject_name from bece_mock_results where exam_session = $2) subj
       left join bece_mock_results mine on mine.subject_name = subj.subject_name and mine.exam_session = $2 and mine.bece_candidate_id = $1
       left join bece_mock_results peers on peers.subject_name = subj.subject_name and peers.exam_session = $2
         and peers.bece_candidate_id in (select id from peer_candidates)
       group by subj.subject_name, mine.grade
       order by subj.subject_name`,
      [beceCandidateId, examSession],
    );
  }

  // --------------------------------------------------------------------
  // 41.3 GES statutory reporting (DOM-070) — read-only aggregations,
  // no new tables.
  // --------------------------------------------------------------------

  async enrolmentCensus(academicYearId: string): Promise<
    { className: string; gender: string | null; status: string; count: number }[]
  > {
    return this.db.query(
      `select c.name as "className", s.gender, e.status, count(*)::int as count
       from enrolments e
       join classes c on c.id = e.class_id
       join students s on s.id = e.student_id
       where e.academic_year_id = $1
       group by c.name, s.gender, e.status
       order by c.name, s.gender, e.status`,
      [academicYearId],
    );
  }

  async attendanceReturns(classId: string, periodStart: string, periodEnd: string): Promise<
    { className: string; presentCount: number; totalCount: number; attendanceRate: number }[]
  > {
    const rows = await this.db.query<{ class_name: string; present: string; total: string }>(
      `select c.name as class_name,
              count(*) filter (where ar.status = 'present') as present,
              count(*) as total
       from attendance_records ar
       join classes c on c.id = ar.class_id
       where ar.class_id = $1 and ar.attendance_date between $2 and $3
       group by c.name`,
      [classId, periodStart, periodEnd],
    );
    return rows.map((r) => ({
      className: r.class_name,
      presentCount: Number(r.present),
      totalCount: Number(r.total),
      attendanceRate: Number(r.total) === 0 ? 0 : Math.round((Number(r.present) / Number(r.total)) * 10000) / 100,
    }));
  }

  // --------------------------------------------------------------------
  // 41.4 CSSPS placement (DOM-080) — informational recording only.
  // --------------------------------------------------------------------

  async recordPlacement(input: RecordCsspsPlacementDto): Promise<CsspsPlacement> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<CsspsPlacement>(
      `insert into cssps_placements (tenant_id, student_id, choices, placement_outcome, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $4)
       on conflict (tenant_id, student_id)
       do update set choices = $2, placement_outcome = coalesce($3, cssps_placements.placement_outcome), updated_at = now(), updated_by = $4
       returning *`,
      [input.studentId, input.choices, input.placementOutcome ?? null, userId],
    );
    return rows[0];
  }

  async confirmPlacement(studentId: string, outcome: string): Promise<CsspsPlacement> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<CsspsPlacement>(
      `update cssps_placements
       set placement_outcome = $2, placement_confirmed_at = now(), updated_at = now(), updated_by = $3
       where student_id = $1
       returning *`,
      [studentId, outcome, userId],
    );
    if (rows.length === 0) {
      throw new ConflictException(`No CSSPS placement record exists yet for student ${studentId} — record choices first`);
    }
    return rows[0];
  }

  async findPlacement(studentId: string): Promise<CsspsPlacement | null> {
    const rows = await this.db.query<CsspsPlacement>(`select * from cssps_placements where student_id = $1`, [studentId]);
    return rows[0] ?? null;
  }
}
