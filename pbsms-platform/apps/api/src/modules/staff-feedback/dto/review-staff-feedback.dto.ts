import { IsOptional, IsString } from 'class-validator';

export class ReviewStaffFeedbackDto {
  @IsOptional()
  @IsString()
  adminNotes?: string;
}
