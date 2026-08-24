import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SubmitProductFeedbackDto {
  @IsIn(['bug', 'feature_request', 'other'])
  category!: 'bug' | 'feature_request' | 'other';

  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsString()
  @IsOptional()
  screen?: string;
}
