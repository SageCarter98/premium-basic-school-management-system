import { IsBoolean } from 'class-validator';

export class AssessBreachDto {
  @IsBoolean()
  meetsStatutoryThreshold!: boolean;
}
