import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

/** record-cssps-placement.dto.ts — DOM-080. Informational recording only
 * — no integration with the real CSSPS system, per the SRS's own
 * explicit words. `choices` mirrors CSSPS's real "up to 6 schools"
 * shape. */
export class RecordCsspsPlacementDto {
  @IsUuidLike()
  studentId!: string;

  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  choices!: string[];

  @IsOptional()
  @IsString()
  placementOutcome?: string;
}
