import { IsNotEmpty, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** file-appeal.dto.ts — FR-OPS-040 appeal. Only valid from a case in
 * 'response_issued' — see discipline.service.ts's fileAppeal(). */
export class FileAppealDto {
  @IsUuidLike()
  raisedBy!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
