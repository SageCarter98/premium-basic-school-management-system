import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const CHANNELS = ['whatsapp', 'sms', 'email', 'in_app'];
const SENSITIVITY_LEVELS = ['normal', 'restricted', 'confidential'];

/** create-template.dto.ts — FR-COM-020. Creating a template with a `code`
 * that already has an active version retires that version and inserts
 * this one as the next version, same shape as grading_policies'
 * draft-then-activate-then-retire-the-old-one lifecycle, collapsed into
 * one call since templates have no separate draft state. */
export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsIn(CHANNELS)
  channel!: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  @IsNotEmpty()
  body!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variables?: string[];

  @IsOptional()
  @IsIn(SENSITIVITY_LEVELS)
  sensitivityLevel?: string;
}
