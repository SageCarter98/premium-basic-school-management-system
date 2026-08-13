import { IsString } from 'class-validator';

export class DunningStepDto {
  @IsString()
  reason!: string;
}
