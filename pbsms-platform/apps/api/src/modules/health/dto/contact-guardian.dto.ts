import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const RECIPIENT_TYPES = ['guardian', 'staff', 'student'];
const CHANNELS = ['whatsapp', 'sms', 'email', 'phone_call', 'in_person'];

/** contact-guardian.dto.ts — FR-OPS-030 guardian notification for
 * incidents. Same shape as discipline's ContactGuardianDto — see
 * health.service.ts's contactGuardian() for the dispatch behavior. */
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
