import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

/** add-fee-structure-item.dto.ts — a single charge line (e.g. "Tuition",
 * "Feeding Fee") within a fee structure. */
export class AddFeeStructureItemDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;
}
