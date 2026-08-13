import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** escalate-report.dto.ts — FR-COM-060's "configurable supervision levels"
 * has no real hierarchy config yet (no tenant org-chart table exists), so
 * the caller names who this escalates to directly — same documented
 * simplification as finance's fixed ASSISTANCE_SECOND_APPROVAL_THRESHOLD. */
export class EscalateReportDto {
  @IsUuidLike()
  escalatedToUserId!: string;
}
