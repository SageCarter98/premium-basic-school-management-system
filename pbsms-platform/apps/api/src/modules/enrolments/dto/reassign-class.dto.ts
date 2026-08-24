import { IsUuidLike } from '../../../common/validation/is-uuid-like';

export class ReassignClassDto {
  @IsUuidLike()
  classId!: string;
}
