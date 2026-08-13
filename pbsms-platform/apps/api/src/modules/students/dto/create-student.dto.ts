import { IsNotEmpty, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/**
 * create-student.dto.ts
 *
 * FR-API-010 (server-side validation). Field names match what
 * StudentsService.create() already expects — see students.service.ts.
 */
export class CreateStudentDto {
  @IsUuidLike()
  schoolId!: string;

  @IsString()
  @IsNotEmpty()
  admissionNo!: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;
}
