import { IsNotEmpty, IsString } from 'class-validator';

export class AttachEvidenceDto {
  @IsString()
  @IsNotEmpty()
  evidence!: string;
}
