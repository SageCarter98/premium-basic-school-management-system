import { IsObject } from 'class-validator';

/** preview-template.dto.ts — FR-COM-020: "a preview validates variable
 * substitution before send." Keys must exactly match the template's own
 * `variables` list — see communication.service.ts's previewTemplate(). */
export class PreviewTemplateDto {
  @IsObject()
  variables!: Record<string, string>;
}
