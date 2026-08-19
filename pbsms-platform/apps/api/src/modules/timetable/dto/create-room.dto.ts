import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

/** create-room.dto.ts — Chapter 17 timetable builder (spec §7.6). */
export class CreateRoomDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}
