import { IsBoolean } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

export class UpsertAcademicSettingsDto {
  @IsUuidLike()
  schoolId!: string;

  @IsBoolean()
  usesNaccaCurriculum!: boolean;
}
