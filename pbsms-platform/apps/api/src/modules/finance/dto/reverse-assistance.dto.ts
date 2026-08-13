import { IsNotEmpty, IsString } from 'class-validator';

export class ReverseAssistanceDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
