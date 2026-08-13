import { IsNotEmpty, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

export class AddCommentDto {
  @IsUuidLike()
  authorUserId!: string;

  @IsString()
  @IsNotEmpty()
  comment!: string;
}
