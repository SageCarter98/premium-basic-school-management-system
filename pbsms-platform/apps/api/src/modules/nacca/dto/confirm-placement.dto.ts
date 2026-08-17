import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmPlacementDto {
  @IsString()
  @IsNotEmpty()
  placementOutcome!: string;
}
