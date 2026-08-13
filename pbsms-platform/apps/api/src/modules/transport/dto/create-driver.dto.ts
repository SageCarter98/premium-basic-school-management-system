import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

export class CreateDriverDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  licenseNo!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsUuidLike()
  vehicleId?: string;
}
