import { IsNotEmpty, IsString } from 'class-validator';

export class ReversePenaltyChargeDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
