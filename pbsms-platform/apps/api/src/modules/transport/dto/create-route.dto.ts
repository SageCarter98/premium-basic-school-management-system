import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateRouteDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
