import { IsUuidLike } from '../../../common/validation/is-uuid-like';

export class AssignRequestDto {
  @IsUuidLike()
  assigneeUserId!: string;
}
