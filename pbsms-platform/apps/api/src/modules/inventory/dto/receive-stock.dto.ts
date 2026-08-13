import { IsInt, Min } from 'class-validator';

export class ReceiveStockDto {
  @IsInt()
  @Min(1)
  quantity!: number;
}
