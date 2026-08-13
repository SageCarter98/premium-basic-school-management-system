import { IsIn, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

const DECISIONS = ['upheld', 'denied'];

/** decide-appeal.dto.ts — closes out a pending appeal and, with it, the
 * case (see discipline.service.ts's decideAppeal()). */
export class DecideAppealDto {
  @IsIn(DECISIONS)
  decision!: string;

  @IsUuidLike()
  decidedBy!: string;

  @IsOptional()
  @IsString()
  decisionNotes?: string;
}
