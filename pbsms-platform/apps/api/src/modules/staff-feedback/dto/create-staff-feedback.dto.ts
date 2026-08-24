import { IsNotEmpty, IsString } from 'class-validator';

export class CreateStaffFeedbackDto {
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;
}
