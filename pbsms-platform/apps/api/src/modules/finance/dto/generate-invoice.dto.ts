import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** generate-invoice.dto.ts — feeStructureId is explicit, not inferred from
 * the student's current enrolment — same "caller names it, engine doesn't
 * guess" reasoning as grading's ComputeResultsDto. prorationFactor
 * defaults to 1.0 (full charge) when omitted — see 0008_finance.sql's
 * header for FR-FEE-030's simplified proration model. */
export class GenerateInvoiceDto {
  @IsUuidLike()
  studentId!: string;

  @IsUuidLike()
  feeStructureId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1)
  prorationFactor?: number;
}
