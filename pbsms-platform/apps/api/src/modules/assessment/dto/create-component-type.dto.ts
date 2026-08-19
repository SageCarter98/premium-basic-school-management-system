import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateComponentTypeDto {
  // snake_case, same shape as the 5 built-ins (class_exercise, etc.) —
  // keeps componentType values consistent regardless of where they came
  // from, and avoids a code value that couldn't round-trip through a URL
  // query param cleanly.
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, { message: 'code must be lowercase snake_case, e.g. practical_exam' })
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;
}
