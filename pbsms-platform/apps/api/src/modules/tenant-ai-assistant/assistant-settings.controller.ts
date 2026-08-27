import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
import { LEADERSHIP } from '../../common/auth/role-groups';
import { AssistantSettingsService } from './assistant-settings.service';
import { UpdateAssistantSettingsDto } from './dto/update-assistant-settings.dto';

/**
 * Chapter 47 stage 1 (§47.0.2): the "disableable by a tenant administrator,
 * globally or per role, taking effect immediately" NFR (§47.13). Thin HTTP
 * wiring only — no UI, not wired into onboarding/subscription flows.
 */
@Controller('v1/assistant/settings')
export class AssistantSettingsController {
  constructor(private readonly settings: AssistantSettingsService) {}

  @Roles(...LEADERSHIP)
  @Get()
  get() {
    return this.settings.get();
  }

  @Roles(...LEADERSHIP)
  @Patch()
  update(@Body() body: UpdateAssistantSettingsDto) {
    return this.settings.update(body);
  }
}
