import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const SUBJECT_TYPES = ['guardian', 'staff', 'student'];
const CONSENT_TYPES = ['communication_channel', 'biometric'];
const CHANNELS = ['whatsapp', 'sms', 'email'];

/** record-consent.dto.ts — DP-070 (per-channel communication consent,
 * versioned, withdrawable) / DP-080 (biometric consent, explicit and
 * separate from general terms). `channel` is required for
 * 'communication_channel' and forbidden for 'biometric' — enforced again
 * in data-protection.service.ts, not just the DB CHECK, so the caller
 * gets a clear 400 rather than a raw constraint-violation 500. */
export class RecordConsentDto {
  @IsIn(SUBJECT_TYPES)
  subjectType!: string;

  @IsUuidLike()
  subjectId!: string;

  @IsIn(CONSENT_TYPES)
  consentType!: string;

  @IsOptional()
  @IsIn(CHANNELS)
  channel?: string;

  @IsBoolean()
  granted!: boolean;
}
