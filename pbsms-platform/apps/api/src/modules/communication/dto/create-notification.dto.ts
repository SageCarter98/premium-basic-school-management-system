import { IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const RECIPIENT_TYPES = ['guardian', 'staff', 'student'];
const SENSITIVITY_LEVELS = ['normal', 'restricted', 'confidential'];

/** create-notification.dto.ts — FR-COM-040. Either `templateId` +
 * `variables` (rendered via the same substitution previewTemplate() uses)
 * or an explicit `subject`/`body` must be supplied — communication.service.ts's
 * createNotification() enforces that, not this DTO, since it depends on
 * which one was given. sensitivityLevel, if omitted, is inherited from the
 * template. */
export class CreateNotificationDto {
  @IsOptional()
  @IsUuidLike()
  templateId?: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsIn(RECIPIENT_TYPES)
  recipientType!: string;

  @IsUuidLike()
  recipientId!: string;

  @IsString()
  @IsNotEmpty()
  recipientName!: string;

  @IsOptional()
  @IsString()
  recipientPhone?: string;

  @IsOptional()
  @IsString()
  recipientEmail?: string;

  @IsOptional()
  @IsIn(SENSITIVITY_LEVELS)
  sensitivityLevel?: string;

  @IsOptional()
  @IsBoolean()
  isUrgent?: boolean;
}
