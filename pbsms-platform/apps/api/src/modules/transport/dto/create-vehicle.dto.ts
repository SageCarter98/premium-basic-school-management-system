import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  registrationNo!: string;

  @IsInt()
  @Min(1)
  capacity!: number;

  @IsOptional()
  @IsUuidLike()
  routeId?: string;
}
