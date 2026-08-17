import { IsNotEmpty, IsString } from 'class-validator';

export class FulfillRequestDto {
  @IsString()
  @IsNotEmpty()
  fulfillmentNotes!: string;
}
