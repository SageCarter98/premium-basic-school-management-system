import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const RESPONSE_TYPES = ['warning', 'detention', 'suspension', 'expulsion_recommendation', 'other'];

/** issue-response.dto.ts — FR-OPS-040 response. A case can have more than
 * one response (e.g. a warning later escalated to a suspension). */
export class IssueResponseDto {
  @IsIn(RESPONSE_TYPES)
  responseType!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsUuidLike()
  issuedBy!: string;
}
