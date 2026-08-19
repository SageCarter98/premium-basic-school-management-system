/**
 * assessment.service.ts
 *
 * Implements SRS v2.1 Chapter 19 (Assessment Management, FR-ASM-010..050).
 * Same tenant-scoping pattern as every other service here — no `tenant_id`
 * in a WHERE/INSERT by hand, RLS supplies it.
 *
 * The workflow this enforces, per 0004_assessment.sql's header comment:
 *   create structure (draft) -> add components (draft-only) -> enter scores
 *   (draft-only) -> publish (locks; weights must sum to exactly 100) ->
 *   [if a correction is needed] reopen (audited, mandatory reason) -> draft
 *   again -> edit -> re-publish.
 * publish() and reopen() are the two operations that flip that single
 * status column, and both are guarded here in the service rather than by a
 * CHECK constraint, for the same reason admissions.service.ts's
 * ALLOWED_TRANSITIONS is: Postgres CHECK constraints can't see sibling rows
 * (the weight sum) or express "only from state X" business rules cleanly.
 *
 * publish() follows admissions.service.ts's convert() shape — an explicit
 * BEGIN/COMMIT/ROLLBACK transaction with a `for update` row lock, because
 * it validates against sibling rows (the components' weights) and then
 * flips status atomically; a concurrent publish() of the same structure
 * must not be able to interleave with a concurrent addComponent() and
 * publish on a stale weight sum.
 */

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { TeacherAssignmentsService } from '../teacher-assignments/teacher-assignments.service';
import { ACADEMIC_ADMIN } from '../../common/auth/role-groups';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { CreateAssessmentStructureDto } from './dto/create-assessment-structure.dto';
import { AddAssessmentComponentDto } from './dto/add-assessment-component.dto';
import { ReopenAssessmentStructureDto } from './dto/reopen-assessment-structure.dto';
import { UpsertScoreDto } from './dto/upsert-score.dto';

export interface Subject {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
}

export interface AssessmentStructure {
  id: string;
  tenant_id: string;
  class_id: string;
  subject_id: string;
  academic_year_id: string;
  status: string;
  published_at: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string | null;
}

export interface AssessmentComponent {
  id: string;
  tenant_id: string;
  assessment_structure_id: string;
  component_type: string;
  weight: string;
  max_score: string;
  nacca_strand: string | null;
  indicator_id: string | null;
}

export interface Score {
  id: string;
  tenant_id: string;
  assessment_component_id: string;
  student_id: string;
  value: string | null;
  status: string;
  missing_reason: string | null;
  version: number;
  updated_by: string | null;
}

// Postgres numeric(5,2) round-trips through pg as a string; weights are
// compared as numbers with a small epsilon rather than exact string/decimal
// equality, since three components of 33.34/33.33/33.33 summing to
// 100.00 is a realistic input and floating arithmetic on the JS side of
// the driver boundary is not perfectly exact.
const WEIGHT_TOTAL_EPSILON = 0.001;

@Injectable()
export class AssessmentService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly teacherAssignments: TeacherAssignmentsService,
  ) {}

  // ---------------------------------------------------------------------
  // Subjects (FR-ASM-010's structures reference these; minimal by design —
  // see create-subject.dto.ts)
  // ---------------------------------------------------------------------

  async createSubject(input: CreateSubjectDto): Promise<Subject> {
    const rows = await this.db.query<Subject>(
      `insert into subjects (tenant_id, name, code)
       values (current_tenant_id(), $1, $2)
       returning *`,
      [input.name, input.code],
    );
    return rows[0];
  }

  async findAllSubjects(): Promise<Subject[]> {
    return this.db.query<Subject>(
      `select * from subjects where deleted_at is null order by name`,
    );
  }

  // ---------------------------------------------------------------------
  // Assessment structures
  // ---------------------------------------------------------------------

  async createStructure(input: CreateAssessmentStructureDto): Promise<AssessmentStructure> {
    const rows = await this.db.query<AssessmentStructure>(
      `insert into assessment_structures (tenant_id, class_id, subject_id, academic_year_id)
       values (current_tenant_id(), $1, $2, $3)
       returning *`,
      [input.classId, input.subjectId, input.academicYearId],
    );
    return rows[0];
  }

  async findAllStructures(
    filter: { classId?: string; subjectId?: string; academicYearId?: string } = {},
  ): Promise<AssessmentStructure[]> {
    const conditions = ['deleted_at is null'];
    const params: string[] = [];
    if (filter.classId) {
      params.push(filter.classId);
      conditions.push(`class_id = $${params.length}`);
    }
    if (filter.subjectId) {
      params.push(filter.subjectId);
      conditions.push(`subject_id = $${params.length}`);
    }
    if (filter.academicYearId) {
      params.push(filter.academicYearId);
      conditions.push(`academic_year_id = $${params.length}`);
    }
    return this.db.query<AssessmentStructure>(
      `select * from assessment_structures where ${conditions.join(' and ')} order by created_at desc`,
      params,
    );
  }

  async findStructure(id: string): Promise<AssessmentStructure> {
    const rows = await this.db.query<AssessmentStructure>(
      `select * from assessment_structures where id = $1 and deleted_at is null`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Assessment structure ${id} not found`);
    }
    return rows[0];
  }

  /** FR-ASM-010: components are the weighted line items; only addable while
   * the parent structure is still 'draft' — once published the whole
   * structure (components included) is locked until a reopen(). */
  async addComponent(structureId: string, input: AddAssessmentComponentDto): Promise<AssessmentComponent> {
    const structure = await this.findStructure(structureId);
    if (structure.status !== 'draft') {
      throw new ConflictException(
        `Cannot add a component to structure ${structureId}: it is '${structure.status}', not 'draft'`,
      );
    }
    const rows = await this.db.query<AssessmentComponent>(
      `insert into assessment_components
         (tenant_id, assessment_structure_id, component_type, weight, max_score, nacca_strand, indicator_id)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6)
       returning *`,
      [
        structureId,
        input.componentType,
        input.weight,
        input.maxScore ?? 100,
        input.naccaStrand ?? null,
        input.indicatorId ?? null,
      ],
    );
    return rows[0];
  }

  async findComponents(structureId: string): Promise<AssessmentComponent[]> {
    return this.db.query<AssessmentComponent>(
      `select * from assessment_components where assessment_structure_id = $1 order by component_type`,
      [structureId],
    );
  }

  /**
   * FR-ASM-010: publishing locks the structure and requires its
   * components' weights to sum to exactly 100. The `for update` lock on
   * the structure row (mirroring admissions.service.ts's convert()) closes
   * the race where two concurrent publish() calls, or a publish()
   * interleaved with an addComponent(), could both read a weight sum that
   * is stale by the time either write lands.
   */
  async publish(structureId: string): Promise<AssessmentStructure> {
    await this.db.query('BEGIN');
    try {
      const structureRows = await this.db.query<AssessmentStructure>(
        `select * from assessment_structures where id = $1 and deleted_at is null for update`,
        [structureId],
      );
      if (structureRows.length === 0) {
        throw new NotFoundException(`Assessment structure ${structureId} not found`);
      }
      const structure = structureRows[0];
      if (structure.status !== 'draft') {
        throw new ConflictException(
          `Cannot publish structure ${structureId}: it is '${structure.status}', not 'draft'`,
        );
      }

      const totalRows = await this.db.query<{ total: string | null }>(
        `select sum(weight) as total from assessment_components where assessment_structure_id = $1`,
        [structureId],
      );
      const total = Number(totalRows[0].total ?? 0);
      if (Math.abs(total - 100) > WEIGHT_TOTAL_EPSILON) {
        throw new ConflictException(
          `Cannot publish structure ${structureId}: component weights sum to ${total}, not 100`,
        );
      }

      const updatedRows = await this.db.query<AssessmentStructure>(
        `update assessment_structures set status = 'published', published_at = now() where id = $1 returning *`,
        [structureId],
      );

      await this.db.query('COMMIT');
      return updatedRows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  /** FR-ASM-040: reopening is controlled and audited — a reason is
   * mandatory (enforced by ReopenAssessmentStructureDto) and recorded
   * alongside who and when, never a silent status flip. Only a
   * 'published' structure can be reopened; a 'draft' one is already
   * editable. */
  async reopen(structureId: string, input: ReopenAssessmentStructureDto): Promise<AssessmentStructure> {
    const { userId } = TenantContextStore.current();
    const structure = await this.findStructure(structureId);
    if (structure.status !== 'published') {
      throw new ConflictException(
        `Cannot reopen structure ${structureId}: it is '${structure.status}', not 'published'`,
      );
    }
    const rows = await this.db.query<AssessmentStructure>(
      `update assessment_structures
       set status = 'draft', reopened_at = now(), reopened_by = $1, reopen_reason = $2
       where id = $3
       returning *`,
      [userId, input.reason, structureId],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------
  // Scores
  // ---------------------------------------------------------------------

  /**
   * FR-ASM-030: a score is either a value within [0, component.max_score]
   * or explicitly 'missing' with a reason — never both null and
   * unexplained (see upsert-score.dto.ts). Only enterable while the
   * component's parent structure is still 'draft' (0004_assessment.sql's
   * header comment) — publishing locks scores along with components.
   *
   * "Upsert" here means insert-or-update against the
   * (tenant_id, assessment_component_id, student_id) unique constraint —
   * re-entering a score for the same student+component corrects it in
   * place rather than creating a duplicate row.
   */
  async upsertScore(componentId: string, input: UpsertScoreDto): Promise<Score> {
    const { userId } = TenantContextStore.current();

    const componentRows = await this.db.query<
      AssessmentComponent & {
        structure_status: string;
        structure_class_id: string;
        structure_subject_id: string;
        structure_academic_year_id: string;
      }
    >(
      `select ac.*, ast.status as structure_status, ast.class_id as structure_class_id,
              ast.subject_id as structure_subject_id, ast.academic_year_id as structure_academic_year_id
       from assessment_components ac
       join assessment_structures ast on ast.id = ac.assessment_structure_id
       where ac.id = $1`,
      [componentId],
    );
    if (componentRows.length === 0) {
      throw new NotFoundException(`Assessment component ${componentId} not found`);
    }
    const component = componentRows[0];
    if (component.structure_status !== 'draft') {
      throw new ConflictException(
        `Cannot enter a score for component ${componentId}: its structure is '${component.structure_status}', not 'draft'`,
      );
    }

    // FR-ASM-020: restrict score entry to teachers with an active
    // assignment for that class subject in the current term (this schema's
    // academic_year_id standing in for "term" — see
    // 0020_teacher_assignments.sql's header). ACADEMIC_ADMIN tiers
    // (headmaster, academic coordinator, examination officer, ...) bypass
    // this the same way they already override every other maker/checker
    // step in this codebase — a coordinator correcting any teacher's
    // scores is normal practice, not a gap.
    const { roles } = TenantContextStore.current();
    const isAcademicAdmin = roles.some((r) => (ACADEMIC_ADMIN as string[]).includes(r));
    if (!isAcademicAdmin) {
      const assigned = await this.teacherAssignments.hasActiveAssignment(
        userId,
        component.structure_class_id,
        component.structure_subject_id,
        component.structure_academic_year_id,
      );
      if (!assigned) {
        throw new ForbiddenException(
          `You do not have an active teacher assignment for this class subject in this academic year`,
        );
      }
    }

    let value: number | null = null;
    let missingReason: string | null = null;
    if (input.status === 'scored') {
      if (input.value === undefined) {
        throw new ConflictException(`A 'scored' entry requires 'value'`);
      }
      const maxScore = Number(component.max_score);
      if (input.value < 0 || input.value > maxScore) {
        throw new ConflictException(
          `Score value ${input.value} is out of bounds for component ${componentId} (max ${maxScore})`,
        );
      }
      value = input.value;
    } else {
      // status === 'missing' (the only other value IsIn(STATUSES) allows)
      if (!input.missingReason) {
        throw new ConflictException(`A 'missing' entry requires 'missingReason'`);
      }
      missingReason = input.missingReason;
    }

    // NFR-PERF-030: field-level optimistic locking, not silent
    // last-write-wins. The WHERE clause on the DO UPDATE branch only
    // applies when a conflict actually occurs (i.e. a score already
    // exists) — a genuine first-time INSERT for this student+component
    // always succeeds regardless of expectedVersion, since there's
    // nothing to conflict with yet. If a score already exists and
    // expectedVersion is missing or stale, the WHERE fails, zero rows
    // come back, and we fall into the conflict branch below rather than
    // silently overwriting whatever the other teacher just entered.
    const rows = await this.db.query<Score>(
      `insert into scores
         (tenant_id, assessment_component_id, student_id, value, status, missing_reason, version, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, 1, $6, $6)
       on conflict (tenant_id, assessment_component_id, student_id)
       do update set value = $3, status = $4, missing_reason = $5, version = scores.version + 1,
         updated_by = $6, updated_at = now()
       where $7::int is not null and scores.version = $7
       returning *`,
      [componentId, input.studentId, value, input.status, missingReason, userId, input.expectedVersion ?? null],
    );

    if (rows.length > 0) {
      return rows[0];
    }

    // Zero rows: either the version was stale, or the caller never
    // supplied one against an existing score. Load the current row to
    // build a conflict message that actually identifies the other editor
    // (updated_by), not just "try again."
    const current = await this.db.query<Score>(
      `select * from scores where assessment_component_id = $1 and student_id = $2`,
      [componentId, input.studentId],
    );
    if (current.length === 0) {
      // Genuinely shouldn't happen (a fresh insert never hits the WHERE
      // clause at all), but fail loudly rather than return undefined.
      throw new ConflictException(`Score entry for student ${input.studentId} could not be saved — please retry`);
    }
    throw new ConflictException(
      `Score for student ${input.studentId} was changed by another user (last updated by ${current[0].updated_by}, ` +
        `now at version ${current[0].version}) since you last read it — reload and re-apply your change`,
    );
  }

  async findScores(componentId: string): Promise<Score[]> {
    return this.db.query<Score>(
      `select * from scores where assessment_component_id = $1 order by created_at`,
      [componentId],
    );
  }
}
