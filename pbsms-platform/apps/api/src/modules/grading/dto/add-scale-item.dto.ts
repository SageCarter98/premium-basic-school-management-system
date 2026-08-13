import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

/** add-scale-item.dto.ts — FR-GRA-030: minValue/maxValue are inclusive
 * percentage bounds. Overlap across a policy's items is rejected by
 * 0005_grading.sql's EXCLUDE constraint (a database-level guarantee, not
 * just a DTO-level one) — this DTO only validates the shape of a single
 * item, not its relationship to its siblings. */
export class AddScaleItemDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  minValue!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  maxValue!: number;

  @IsString()
  @IsNotEmpty()
  grade!: string;

  @IsOptional()
  @IsNumber()
  point?: number;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsBoolean()
  isPass?: boolean;
}
