import { Module } from '@nestjs/common';
import { TeacherAssignmentsModule } from '../teacher-assignments/teacher-assignments.module';
import { AssistantInteractionLogger } from './assistant-interaction-logger.service';
import { AssistantRetrievalController } from './assistant-retrieval.controller';
import { AssistantRetrievalService } from './assistant-retrieval.service';
import { AssistantSettingsController } from './assistant-settings.controller';
import { AssistantSettingsService } from './assistant-settings.service';

/**
 * Chapter 47 stage 1-2 (§47.0.2): "retrieval layer under RLS, scope
 * enforcement, audit logging — no model in the loop." Reuses
 * TeacherAssignmentsService.getCallerScope() for TEN-051 rather than
 * reimplementing Chapter 13 scope resolution — the same reuse
 * finance/results modules already rely on.
 */
@Module({
  imports: [TeacherAssignmentsModule],
  controllers: [AssistantRetrievalController, AssistantSettingsController],
  providers: [AssistantRetrievalService, AssistantSettingsService, AssistantInteractionLogger],
})
export class TenantAiAssistantModule {}
