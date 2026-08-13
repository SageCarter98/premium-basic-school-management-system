import { IsNotEmpty, IsString } from 'class-validator';

export class RejectAssistanceDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
