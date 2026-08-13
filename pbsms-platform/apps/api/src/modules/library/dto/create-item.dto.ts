import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

/** create-item.dto.ts — FR-OPS-010 catalogue. */
export class CreateItemDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  isbn?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsInt()
  @Min(0)
  totalCopies!: number;
}
