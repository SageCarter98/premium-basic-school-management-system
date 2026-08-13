import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class AddStopDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsInt()
  @Min(1)
  sequenceNo!: number;
}
