import { IsOptional } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** create-member.dto.ts — exactly one of studentId/staffUserId must be
 * supplied; library.service.ts's createMember() enforces that (see
 * library_members_exactly_one_link, mirrored at the app layer since a DB
 * CHECK can't produce a friendly error message). */
export class CreateMemberDto {
  @IsOptional()
  @IsUuidLike()
  studentId?: string;

  @IsOptional()
  @IsUuidLike()
  staffUserId?: string;
}
