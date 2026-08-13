import { IsNotEmpty, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** add-note.dto.ts — investigation/follow-up log entry on a case. */
export class AddNoteDto {
  @IsUuidLike()
  authorUserId!: string;

  @IsString()
  @IsNotEmpty()
  note!: string;
}
