import { IsNotEmpty, IsString } from 'class-validator';

/** create-subject.dto.ts — FR-ASM-010's assessment structures reference a
 * subject; subjects themselves are minimal (name + tenant-unique code)
 * since the full curriculum/NaCCA subject catalogue is out of scope here. */
export class CreateSubjectDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}
