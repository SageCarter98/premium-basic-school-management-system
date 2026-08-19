import { IsOptional, IsString } from 'class-validator';

export class EndTimetableEntryDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
