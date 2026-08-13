/**
 * promotion.service.ts
 *
 * Implements SRS v2.1 Chapter 22.2 (Promotion & JHS Completion,
 * FR-PRO-010..030). Reads student_results (0006_results.sql) but never
 * writes to it — a promotion decision is built ON TOP OF an approved
 * result, the same "read, never mutate the upstream module's own table"
 * boundary grading.service.ts keeps against assessment's tables.
 *
 * recommend()'s heuristic (pass -> promote, except a JHS 3 pass ->
 * complete; fail -> repeat) is deliberately simple — see
 * 0007_promotion_documents.sql's header for why a real configurable
 * per-division/class-level policy engine (FR-PRO-020) is documented
 * future scope rather than built here. What IS real is the separation
 * FR-PRO-020 actually requires: recommend() only ever writes
 * system_recommendation; only decide() writes decision.
 *
 * apply() mirrors admissions.service.ts's convert() shape — a multi-
 * statement transaction that closes one row and creates/updates others
 * atomically (FR-PRO-030: "closing the prior enrolment rather than
 * mutating it").
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { RecommendPromotionDto } from './dto/recommend-promotion.dto';
import { DecidePromotionDto } from './dto/decide-promotion.dto';

export interface PromotionDecision {
  id: string;
  tenant_id: string;
  student_id: string;
  source_student_result_id: string;
  system_recommendation: string;
  decision: string | null;
  status: string;
  decided_at: string | null;
  decided_by: string | null;
  to_class_id: string | null;
  to_academic_year_id: string | null;
  new_enrolment_id: string | null;
  applied_at: string | null;
  applied_by: string | null;
  notes: string | null;
}

interface StudentResultRow {
  id: string;
  student_id: string;
  class_id: string;
  academic_year_id: string;
  status: string;
  overall_pass: boolean | null;
}

const APPROVED_STATUSES = ['published', 'locked', 'archived'];
const DESTINATION_REQUIRED_DECISIONS = ['promoted', 'repeated', 'conditional'];

function isPgError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

@Injectable()
export class PromotionService {
  constructor(private readonly db: TenantDatabaseService) {}

  async findAll(): Promise<PromotionDecision[]> {
    return this.db.query<PromotionDecision>(`select * from promotion_decisions order by created_at desc`);
  }

  async findOne(id: string): Promise<PromotionDecision> {
    const rows = await this.db.query<PromotionDecision>(`select * from promotion_decisions where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Promotion decision ${id} not found`);
    }
    return rows[0];
  }

  async recommend(input: RecommendPromotionDto): Promise<PromotionDecision> {
    const { userId } = TenantContextStore.current();

    const resultRows = await this.db.query<StudentResultRow>(
      `select id, student_id, class_id, academic_year_id, status, overall_pass from student_results where id = $1`,
      [input.sourceStudentResultId],
    );
    if (resultRows.length === 0) {
      throw new NotFoundException(`Student result ${input.sourceStudentResultId} not found`);
    }
    const result = resultRows[0];
    if (!APPROVED_STATUSES.includes(result.status)) {
      throw new ConflictException(
        `Cannot recommend a promotion decision from result ${result.id}: it is '${result.status}', not published/locked/archived (FR-PRO-010 requires approved evidence)`,
      );
    }
    if (result.overall_pass === null) {
      throw new ConflictException(
        `Cannot recommend a promotion decision from result ${result.id}: it has no graded subjects`,
      );
    }

    const classRows = await this.db.query<{ level: string }>(`select level from classes where id = $1`, [
      result.class_id,
    ]);
    const level = classRows[0]?.level;

    let systemRecommendation: string;
    if (!result.overall_pass) {
      systemRecommendation = 'repeat';
    } else if (level === 'JHS 3') {
      systemRecommendation = 'complete';
    } else {
      systemRecommendation = 'promote';
    }

    try {
      const rows = await this.db.query<PromotionDecision>(
        `insert into promotion_decisions
           (tenant_id, student_id, source_student_result_id, system_recommendation, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4)
         returning *`,
        [result.student_id, result.id, systemRecommendation, userId],
      );
      return rows[0];
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        throw new ConflictException(
          `Student ${result.student_id} already has a promotion decision for result ${result.id}`,
        );
      }
      throw err;
    }
  }

  async decide(id: string, input: DecidePromotionDto): Promise<PromotionDecision> {
    const { userId } = TenantContextStore.current();
    const decision = await this.findOne(id);
    if (decision.status !== 'recommended') {
      throw new ConflictException(`Cannot decide promotion ${id}: it is '${decision.status}', not recommended`);
    }
    if (DESTINATION_REQUIRED_DECISIONS.includes(input.decision) && (!input.toClassId || !input.toAcademicYearId)) {
      throw new ConflictException(
        `Decision '${input.decision}' requires both toClassId and toAcademicYearId`,
      );
    }

    const rows = await this.db.query<PromotionDecision>(
      `update promotion_decisions
       set decision = $1, status = 'decided', decided_at = now(), decided_by = $2,
           to_class_id = $3, to_academic_year_id = $4, notes = $5
       where id = $6
       returning *`,
      [
        input.decision,
        userId,
        input.toClassId ?? null,
        input.toAcademicYearId ?? null,
        input.notes ?? null,
        id,
      ],
    );
    return rows[0];
  }

  /**
   * FR-PRO-030. `for update` on the decision row for the same reason
   * assessment/grading/results' equivalent transactional methods use
   * it — this validates against and then mutates sibling data (the
   * enrolment) and must not interleave with a concurrent apply() of the
   * same decision.
   */
  async apply(id: string): Promise<PromotionDecision> {
    const { userId } = TenantContextStore.current();
    await this.db.query('BEGIN');
    try {
      const decisionRows = await this.db.query<PromotionDecision>(
        `select * from promotion_decisions where id = $1 for update`,
        [id],
      );
      if (decisionRows.length === 0) {
        throw new NotFoundException(`Promotion decision ${id} not found`);
      }
      const decision = decisionRows[0];
      if (decision.status !== 'decided') {
        throw new ConflictException(`Cannot apply promotion ${id}: it is '${decision.status}', not decided`);
      }

      const resultRows = await this.db.query<StudentResultRow>(
        `select class_id, academic_year_id from student_results where id = $1`,
        [decision.source_student_result_id],
      );
      const source = resultRows[0];

      const enrolmentRows = await this.db.query<{ id: string }>(
        `select id from enrolments
         where student_id = $1 and class_id = $2 and academic_year_id = $3 and status = 'active' and deleted_at is null`,
        [decision.student_id, source.class_id, source.academic_year_id],
      );
      if (enrolmentRows.length === 0) {
        throw new ConflictException(
          `Cannot apply promotion ${id}: no active enrolment found for student ${decision.student_id} in the source class+year`,
        );
      }
      const oldEnrolmentId = enrolmentRows[0].id;

      let newEnrolmentId: string | null = null;

      if (DESTINATION_REQUIRED_DECISIONS.includes(decision.decision ?? '')) {
        await this.db.query(
          `update enrolments set status = 'closed', end_date = current_date, closed_reason = $1, updated_by = $2 where id = $3`,
          [`Promotion decision ${id}: ${decision.decision}`, userId, oldEnrolmentId],
        );
        const newEnrolmentRows = await this.db.query<{ id: string }>(
          `insert into enrolments (tenant_id, student_id, academic_year_id, class_id, created_by, updated_by)
           values (current_tenant_id(), $1, $2, $3, $4, $4)
           returning id`,
          [decision.student_id, decision.to_academic_year_id, decision.to_class_id, userId],
        );
        newEnrolmentId = newEnrolmentRows[0].id;
      } else if (decision.decision === 'transferred') {
        await this.db.query(
          `update enrolments set status = 'closed', end_date = current_date, closed_reason = 'transferred', updated_by = $1 where id = $2`,
          [userId, oldEnrolmentId],
        );
        await this.db.query(`update students set status = 'transferred', updated_by = $1 where id = $2`, [
          userId,
          decision.student_id,
        ]);
      } else if (decision.decision === 'completed') {
        await this.db.query(
          `update enrolments set status = 'closed', end_date = current_date, closed_reason = 'completed', updated_by = $1 where id = $2`,
          [userId, oldEnrolmentId],
        );
        await this.db.query(`update students set status = 'graduated', updated_by = $1 where id = $2`, [
          userId,
          decision.student_id,
        ]);
      }
      // decision.decision === 'pending': no enrolment/student change —
      // applying a 'pending' outcome just records that no action is taken
      // yet, per FR-PRO-010 listing 'pending' as a valid outcome value.

      const updatedRows = await this.db.query<PromotionDecision>(
        `update promotion_decisions
         set status = 'applied', applied_at = now(), applied_by = $1, new_enrolment_id = $2
         where id = $3
         returning *`,
        [userId, newEnrolmentId, id],
      );
      await this.db.query('COMMIT');
      return updatedRows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }
}
