import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateAssistantSettingsDto {
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  disabledRoleCodes?: string[];
}
