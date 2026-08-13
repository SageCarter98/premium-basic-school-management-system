/**
 * grading.service.ts
 *
 * Implements SRS v2.1 Chapter 20 (Enterprise Grading Engine, FR-GRA-010..070).
 * Reads assessment_structures/assessment_components/scores (0004_assessment.sql)
 * but never writes to them — FR-GRA-010: "the engine never collects scores
 * directly." That boundary is enforced here simply by this service never
 * containing an INSERT/UPDATE against those three tables, not by a DB grant
 * (pbsms_app already has DML on them for assessment.service.ts's own use).
 *
 * compute() takes an explicit gradingPolicyId rather than resolving "the
 * current active policy for this applicability" itself. That's a deliberate
 * choice, not a missing feature: FR-GRA-060 requires undefined/incomplete
 * inputs to stop processing with an actionable error rather than a silent
 * default, and an implicit "current policy" lookup is exactly the kind of
 * silent default that becomes ambiguous the moment two policies are ever
 * active at once (e.g. mid-rollout of a new grading scale). Making the
 * caller name the policy explicitly — the same shape as
 * assessment.service.ts's createStructure() requiring an explicit
 * classId/subjectId/academicYearId rather than inferring them — pushes that
 * ambiguity to a place a human resolves it, not runtime guesswork.
 *
 * compute() runs as one transaction across the whole class roster
 * (BEGIN/COMMIT/ROLLBACK, like admissions.service.ts's convert()) rather
 * than per-student independence (like attendance.service.ts's sync()):
 * FR-GRA-060's "stop processing" is singular-pipeline language, and a
 * partially-graded class (29 students landed, 1 silently skipped) is a
 * worse failure mode here than attendance's per-entry batch, where each
 * entry really is independent of the others.
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { CreateGradingPolicyDto } from './dto/create-grading-policy.dto';
import { AddScaleItemDto } from './dto/add-scale-item.dto';
import { ComputeResultsDto } from './dto/compute-results.dto';
import { RankResultsDto } from './dto/rank-results.dto';

export interface GradingPolicy {
  id: string;
  tenant_id: string;
  name: string;
  applicability: string;
  version: number;
  status: string;
  activated_at: string | null;
  retired_at: string | null;
}

export interface GradingScaleItem {
  id: string;
  tenant_id: string;
  grading_policy_id: string;
  min_value: string;
  max_value: string;
  grade: string;
  point: string | null;
  remark: string | null;
  is_pass: boolean;
}

export interface ResultCandidate {
  id: string;
  tenant_id: string;
  assessment_structure_id: string;
  student_id: string;
  grading_policy_id: string;
  percentage: string;
  grade: string;
  point: string | null;
  remark: string | null;
  is_pass: boolean;
  rank: number | null;
  computed_at: string;
}

interface AssessmentStructureRow {
  id: string;
  class_id: string;
  academic_year_id: string;
  status: string;
}

interface AssessmentComponentRow {
  id: string;
  component_type: string;
  weight: string;
  max_score: string;
}

interface ScoreRow {
  assessment_component_id: string;
  student_id: string;
  value: string | null;
  status: string;
}

// Coverage-gap tolerance for activatePolicy()'s "no unintended gaps" check —
// numeric(5,2) columns have 0.01 granularity, so a correctly-contiguous
// policy's items differ by exactly 0.01 at each boundary; this epsilon just
// absorbs floating-point round-trip noise through the pg driver's string
// parsing, the same reasoning as assessment.service.ts's WEIGHT_TOTAL_EPSILON.
const GAP_EPSILON = 0.005;

function isPgError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

@Injectable()
export class GradingService {
  constructor(private readonly db: TenantDatabaseService) {}

  // ---------------------------------------------------------------------
  // Grading policies
  // ---------------------------------------------------------------------

  async createPolicy(input: CreateGradingPolicyDto): Promise<GradingPolicy> {
    const rows = await this.db.query<GradingPolicy>(
      `insert into grading_policies (tenant_id, name, applicability, version)
       values (current_tenant_id(), $1, $2, $3)
       returning *`,
      [input.name, input.applicability, input.version ?? 1],
    );
    return rows[0];
  }

  async findAllPolicies(): Promise<GradingPolicy[]> {
    return this.db.query<GradingPolicy>(`select * from grading_policies order by name, version`);
  }

  async findPolicy(id: string): Promise<GradingPolicy> {
    const rows = await this.db.query<GradingPolicy>(`select * from grading_policies where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Grading policy ${id} not found`);
    }
    return rows[0];
  }

  /** FR-GRA-030: overlap is rejected by 0005_grading.sql's EXCLUDE
   * constraint; caught here and translated into a clean 409 rather than
   * the raw 500 a bare Postgres constraint violation would otherwise
   * surface as. */
  async addScaleItem(policyId: string, input: AddScaleItemDto): Promise<GradingScaleItem> {
    const policy = await this.findPolicy(policyId);
    if (policy.status !== 'draft') {
      throw new ConflictException(
        `Cannot add a scale item to policy ${policyId}: it is '${policy.status}', not 'draft'`,
      );
    }
    if (input.minValue > input.maxValue) {
      throw new ConflictException(`minValue (${input.minValue}) cannot exceed maxValue (${input.maxValue})`);
    }
    try {
      const rows = await this.db.query<GradingScaleItem>(
        `insert into grading_scale_items
           (tenant_id, grading_policy_id, min_value, max_value, grade, point, remark, is_pass)
         values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7)
         returning *`,
        [
          policyId,
          input.minValue,
          input.maxValue,
          input.grade,
          input.point ?? null,
          input.remark ?? null,
          input.isPass ?? true,
        ],
      );
      return rows[0];
    } catch (err) {
      if (isPgError(err) && err.code === '23P01') {
        throw new ConflictException(
          `Cannot add scale item [${input.minValue}, ${input.maxValue}] to policy ${policyId}: it overlaps an existing band`,
        );
      }
      if (isPgError(err) && err.code === '23505') {
        throw new ConflictException(
          `Cannot add scale item to policy ${policyId}: grade '${input.grade}' is already used by another band on this policy`,
        );
      }
      throw err;
    }
  }

  async findScaleItems(policyId: string): Promise<GradingScaleItem[]> {
    return this.db.query<GradingScaleItem>(
      `select * from grading_scale_items where grading_policy_id = $1 order by min_value`,
      [policyId],
    );
  }

  /**
   * FR-GRA-030's other half ("or leave unintended gaps") — not DB-
   * enforceable via a pairwise constraint like overlap is, so validated
   * here: sorted scale items must chain from exactly 0 to exactly 100
   * with no space between one item's max and the next item's min.
   */
  async activatePolicy(policyId: string): Promise<GradingPolicy> {
    await this.db.query('BEGIN');
    try {
      const policyRows = await this.db.query<GradingPolicy>(
        `select * from grading_policies where id = $1 for update`,
        [policyId],
      );
      if (policyRows.length === 0) {
        throw new NotFoundException(`Grading policy ${policyId} not found`);
      }
      const policy = policyRows[0];
      if (policy.status !== 'draft') {
        throw new ConflictException(`Cannot activate policy ${policyId}: it is '${policy.status}', not 'draft'`);
      }

      const items = await this.db.query<GradingScaleItem>(
        `select * from grading_scale_items where grading_policy_id = $1 order by min_value`,
        [policyId],
      );
      if (items.length === 0) {
        throw new ConflictException(`Cannot activate policy ${policyId}: it has no scale items defined`);
      }
      if (Math.abs(Number(items[0].min_value) - 0) > GAP_EPSILON) {
        throw new ConflictException(
          `Cannot activate policy ${policyId}: coverage starts at ${items[0].min_value}, not 0`,
        );
      }
      const last = items[items.length - 1];
      if (Math.abs(Number(last.max_value) - 100) > GAP_EPSILON) {
        throw new ConflictException(
          `Cannot activate policy ${policyId}: coverage ends at ${last.max_value}, not 100`,
        );
      }
      for (let i = 1; i < items.length; i++) {
        const expectedMin = Number(items[i - 1].max_value) + 0.01;
        if (Math.abs(Number(items[i].min_value) - expectedMin) > GAP_EPSILON) {
          throw new ConflictException(
            `Cannot activate policy ${policyId}: gap between ${items[i - 1].max_value} (grade '${items[i - 1].grade}') and ${items[i].min_value} (grade '${items[i].grade}')`,
          );
        }
      }

      const updatedRows = await this.db.query<GradingPolicy>(
        `update grading_policies set status = 'active', activated_at = now() where id = $1 returning *`,
        [policyId],
      );
      await this.db.query('COMMIT');
      return updatedRows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  async retirePolicy(policyId: string): Promise<GradingPolicy> {
    const policy = await this.findPolicy(policyId);
    if (policy.status !== 'active') {
      throw new ConflictException(`Cannot retire policy ${policyId}: it is '${policy.status}', not 'active'`);
    }
    const rows = await this.db.query<GradingPolicy>(
      `update grading_policies set status = 'retired', retired_at = now() where id = $1 returning *`,
      [policyId],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------
  // Compute / rank
  // ---------------------------------------------------------------------

  /**
   * FR-GRA-040's pipeline for every actively-enrolled student in the
   * structure's class+year: approved scores -> weighted total ->
   * percentage -> scale lookup -> grade/remark. FR-GRA-060: a missing or
   * non-'scored' entry for ANY of the structure's components, for ANY
   * student, aborts the whole call (see class header comment) rather than
   * defaulting that component to zero — silently treating "missing" as
   * "zero" is exactly the kind of silent default FR-GRA-060 forbids; a
   * genuinely-absent student's score needs a human decision (re-enter,
   * or a future Chapter 21 "formally exempted" flag), not an engine
   * guess.
   */
  async compute(structureId: string, input: ComputeResultsDto): Promise<ResultCandidate[]> {
    const { userId } = TenantContextStore.current();
    await this.db.query('BEGIN');
    try {
      const structureRows = await this.db.query<AssessmentStructureRow>(
        `select id, class_id, academic_year_id, status from assessment_structures where id = $1 and deleted_at is null`,
        [structureId],
      );
      if (structureRows.length === 0) {
        throw new NotFoundException(`Assessment structure ${structureId} not found`);
      }
      const structure = structureRows[0];
      if (structure.status !== 'published') {
        throw new ConflictException(
          `Cannot compute results for structure ${structureId}: it is '${structure.status}', not 'published' (FR-GRA-010 only interprets approved data)`,
        );
      }

      const policyRows = await this.db.query<GradingPolicy>(
        `select * from grading_policies where id = $1`,
        [input.gradingPolicyId],
      );
      if (policyRows.length === 0) {
        throw new NotFoundException(`Grading policy ${input.gradingPolicyId} not found`);
      }
      const policy = policyRows[0];
      if (policy.status !== 'active') {
        throw new ConflictException(
          `Cannot compute results with policy ${input.gradingPolicyId}: it is '${policy.status}', not 'active'`,
        );
      }

      const components = await this.db.query<AssessmentComponentRow>(
        `select id, component_type, weight, max_score from assessment_components where assessment_structure_id = $1`,
        [structureId],
      );
      if (components.length === 0) {
        throw new ConflictException(
          `Cannot compute results for structure ${structureId}: it has no components defined (FR-GRA-060)`,
        );
      }

      const scaleItems = await this.db.query<GradingScaleItem>(
        `select * from grading_scale_items where grading_policy_id = $1 order by min_value`,
        [input.gradingPolicyId],
      );
      if (scaleItems.length === 0) {
        throw new ConflictException(
          `Cannot compute results with policy ${input.gradingPolicyId}: it has no scale items defined (FR-GRA-060)`,
        );
      }

      const roster = await this.db.query<{ student_id: string }>(
        `select student_id from enrolments
         where class_id = $1 and academic_year_id = $2 and status = 'active' and deleted_at is null`,
        [structure.class_id, structure.academic_year_id],
      );
      if (roster.length === 0) {
        throw new ConflictException(
          `Cannot compute results for structure ${structureId}: no active enrolments found for its class`,
        );
      }

      const componentIds = components.map((c) => c.id);
      const scores = await this.db.query<ScoreRow>(
        `select assessment_component_id, student_id, value, status from scores where assessment_component_id = any($1::uuid[])`,
        [componentIds],
      );
      const scoreByComponentAndStudent = new Map<string, ScoreRow>();
      for (const score of scores) {
        scoreByComponentAndStudent.set(`${score.assessment_component_id}:${score.student_id}`, score);
      }

      const results: ResultCandidate[] = [];
      for (const { student_id: studentId } of roster) {
        let percentage = 0;
        for (const component of components) {
          const score = scoreByComponentAndStudent.get(`${component.id}:${studentId}`);
          if (!score || score.status !== 'scored' || score.value === null) {
            throw new ConflictException(
              `Cannot compute results: student ${studentId} has no scored entry for component ` +
                `'${component.component_type}' (${component.id}) — incomplete components stop processing (FR-GRA-060)`,
            );
          }
          percentage += (Number(score.value) / Number(component.max_score)) * Number(component.weight);
        }
        percentage = Math.round(percentage * 100) / 100;

        const scaleItem = scaleItems.find(
          (item) => percentage >= Number(item.min_value) && percentage <= Number(item.max_value),
        );
        if (!scaleItem) {
          throw new ConflictException(
            `Cannot compute results: ${percentage}% for student ${studentId} falls outside every defined band ` +
              `of policy ${input.gradingPolicyId} — the policy has a gap (FR-GRA-060)`,
          );
        }

        const rows = await this.db.query<ResultCandidate>(
          `insert into result_candidates
             (tenant_id, assessment_structure_id, student_id, grading_policy_id, percentage, grade, point, remark, is_pass, rank, computed_at, created_by)
           values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, null, now(), $9)
           on conflict (tenant_id, assessment_structure_id, student_id)
           do update set grading_policy_id = $3, percentage = $4, grade = $5, point = $6, remark = $7,
                          is_pass = $8, rank = null, computed_at = now(), created_by = $9
           returning *`,
          [
            structureId,
            studentId,
            input.gradingPolicyId,
            percentage,
            scaleItem.grade,
            scaleItem.point,
            scaleItem.remark,
            scaleItem.is_pass,
            userId,
          ],
        );
        results.push(rows[0]);
      }

      await this.db.query('COMMIT');
      return results;
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  /**
   * FR-GRA-050: competition ("1224") skips ranks after a tie; dense
   * ("1223") does not; 'none' clears ranking. Forced to 'none' regardless
   * of the requested mode when the policy is 'developmental' — ranking
   * Nursery/KG learners against each other is exactly what that
   * applicability exists to avoid.
   */
  async rank(structureId: string, input: RankResultsDto): Promise<ResultCandidate[]> {
    const candidates = await this.db.query<ResultCandidate>(
      `select * from result_candidates where assessment_structure_id = $1 order by percentage desc, student_id`,
      [structureId],
    );
    if (candidates.length === 0) {
      throw new NotFoundException(
        `No computed results found for structure ${structureId} — call compute() first`,
      );
    }

    const policy = await this.findPolicy(candidates[0].grading_policy_id);
    const mode = policy.applicability === 'developmental' ? 'none' : input.mode;

    const ranks = new Map<string, number | null>();
    if (mode === 'none') {
      for (const c of candidates) ranks.set(c.id, null);
    } else {
      let previousPercentage: number | null = null;
      let currentRank = 0;
      let seen = 0;
      for (const c of candidates) {
        seen += 1;
        const pct = Number(c.percentage);
        if (previousPercentage === null || pct !== previousPercentage) {
          currentRank = mode === 'dense' ? currentRank + 1 : seen;
          previousPercentage = pct;
        }
        ranks.set(c.id, currentRank);
      }
    }

    await this.db.query('BEGIN');
    try {
      for (const c of candidates) {
        await this.db.query(`update result_candidates set rank = $1 where id = $2`, [ranks.get(c.id), c.id]);
      }
      await this.db.query('COMMIT');
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }

    return this.db.query<ResultCandidate>(
      `select * from result_candidates where assessment_structure_id = $1 order by rank nulls last, percentage desc`,
      [structureId],
    );
  }

  async findResults(structureId: string): Promise<ResultCandidate[]> {
    return this.db.query<ResultCandidate>(
      `select * from result_candidates where assessment_structure_id = $1 order by rank nulls last, percentage desc`,
      [structureId],
    );
  }
}
