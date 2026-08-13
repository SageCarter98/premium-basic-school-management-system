import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateItemDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsInt()
  @Min(0)
  quantityOnHand!: number;

  @IsInt()
  @Min(0)
  reorderThreshold!: number;
}
