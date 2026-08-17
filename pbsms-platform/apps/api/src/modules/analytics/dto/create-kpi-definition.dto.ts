import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const DATA_SOURCES = ['collection_rate', 'attendance_rate', 'academic_performance', 'outstanding_actions'];
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'termly', 'yearly'];

/** create-kpi-definition.dto.ts — Chapter 14.2's metadata list. See
 * 0028_analytics.sql's header for why `dataSource` is a fixed enum of
 * real calculators rather than an executable formula string. */
export class CreateKpiDefinitionDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  responsibleRole!: string;

  @IsIn(DATA_SOURCES)
  dataSource!: string;

  @IsOptional()
  @IsString()
  formulaDescription?: string;

  @IsOptional()
  @IsNumber()
  target?: number;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsNumber()
  warningThreshold?: number;

  @IsOptional()
  @IsNumber()
  criticalThreshold?: number;

  @IsIn(FREQUENCIES)
  reportingFrequency!: string;

  @IsOptional()
  @IsUuidLike()
  supervisorUserId?: string;

  /** Omit for a tenant-wide KPI; set for a single school's KPI (14.2's
   * "tenant scope"). */
  @IsOptional()
  @IsUuidLike()
  schoolId?: string;
}
