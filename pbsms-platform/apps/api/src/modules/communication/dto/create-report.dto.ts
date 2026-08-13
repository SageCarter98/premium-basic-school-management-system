import { IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** create-report.dto.ts — FR-COM-060: an actionable report/task assigned
 * to a staff owner, optionally tied to the notification that delivered it
 * (not required — see 0010_communication.sql's header on why a report
 * doesn't depend on the underlying send having succeeded). */
export class CreateReportDto {
  @IsOptional()
  @IsUuidLike()
  notificationId?: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUuidLike()
  ownerUserId!: string;

  @IsOptional()
  @IsUuidLike()
  assignedBy?: string;

  @IsOptional()
  @IsISO8601()
  deadline?: string;
}
