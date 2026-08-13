import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const RECIPIENT_TYPES = ['guardian', 'staff', 'student'];
const CHANNELS = ['whatsapp', 'sms', 'email', 'phone_call', 'in_person'];

/** contact-guardian.dto.ts — FR-OPS-040 guardian contact. When `channel` is
 * a dispatch channel ('whatsapp'/'sms'/'email'), discipline.service.ts's
 * contactGuardian() sends a real notification via CommunicationService with
 * sensitivity 'confidential' (FR-COM-050); 'phone_call'/'in_person' (or no
 * channel at all) are logged only. */
export class ContactGuardianDto {
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
  @IsIn(CHANNELS)
  channel?: string;

  @IsString()
  @IsNotEmpty()
  notes!: string;

  @IsUuidLike()
  contactedBy!: string;
}
