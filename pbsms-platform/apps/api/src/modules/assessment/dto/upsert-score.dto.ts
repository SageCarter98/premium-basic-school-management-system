import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const STATUSES = ['scored', 'missing'];

/** upsert-score.dto.ts — FR-ASM-030: a score is either a value (checked
 * against the component's own max_score in assessment.service.ts, since
 * that bound is per-component, not a fixed constant here) or explicitly
 * 'missing' with a reason. Which field is required depends on `status`,
 * which class-validator's per-field decorators can't express against a
 * sibling field cleanly — that cross-check lives in the service instead,
 * same as admissions.service.ts's status-transition checks.
 *
 * expectedVersion — NFR-PERF-030's optimistic-locking token. The client
 * reads the current score first (findScores()), then submits back the
 * `version` it saw; omit it only when you know no score exists yet for
 * this student+component (a genuine first entry) — omitting it against
 * an EXISTING score is treated as a conflict, not a silent overwrite,
 * see assessment.service.ts's upsertScore(). */
export class UpsertScoreDto {
  @IsUuidLike()
  studentId!: string;

  @IsIn(STATUSES)
  status!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsString()
  missingReason?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
