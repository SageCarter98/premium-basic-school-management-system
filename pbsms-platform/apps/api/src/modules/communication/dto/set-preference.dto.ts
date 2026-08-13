import { IsBoolean, IsIn } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const RECIPIENT_TYPES = ['guardian', 'staff', 'student'];
const CHANNELS = ['whatsapp', 'sms', 'email'];

/** set-preference.dto.ts — FR-COM-050. `recipientId` is not FK-checked
 * against any table (guardians don't exist as one yet — see
 * 0010_communication.sql's header); this endpoint trusts the caller's id. */
export class SetPreferenceDto {
  @IsIn(RECIPIENT_TYPES)
  recipientType!: string;

  @IsUuidLike()
  recipientId!: string;

  @IsIn(CHANNELS)
  channel!: string;

  @IsBoolean()
  optedIn!: boolean;
}
