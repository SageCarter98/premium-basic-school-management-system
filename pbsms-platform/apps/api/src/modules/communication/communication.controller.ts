import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { PreviewTemplateDto } from './dto/preview-template.dto';
import { SetPreferenceDto } from './dto/set-preference.dto';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { AttachEvidenceDto } from './dto/attach-evidence.dto';
import { EscalateReportDto } from './dto/escalate-report.dto';
import { UpsertSettingsDto } from './dto/upsert-settings.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';

/** communication.controller.ts — SRS Chapter 26. Template/settings
 * configuration and directly triggering an arbitrary notification/report
 * assignment or escalation are ACADEMIC_ADMIN; acting on a report you
 * already own (acknowledge/start/evidence/complete/reopen/comment) is
 * ACADEMIC_STAFF, since the assigned owner of an acknowledgeable report
 * can be any staff member, not just admin tier. Note: this only gates the
 * direct HTTP surface — cross-module calls like discipline's
 * contactGuardian() invoke CommunicationService in-process within the
 * caller's own already-authorized request, not as a second HTTP call, so
 * they are unaffected by these decorators either way. */
@Controller('v1/communication')
export class CommunicationController {
  constructor(private readonly communication: CommunicationService) {}

  @Roles(...ACADEMIC_ADMIN)
  @Post('templates')
  createTemplate(@Body() body: CreateTemplateDto) {
    return this.communication.createTemplate(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('templates')
  findAllTemplates() {
    return this.communication.findAllTemplates();
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('templates/by-code/:code')
  findActiveTemplateByCode(@Param('code') code: string) {
    return this.communication.findActiveTemplateByCode(code);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('templates/by-code/:code/versions')
  findTemplateVersions(@Param('code') code: string) {
    return this.communication.findTemplateVersions(code);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('templates/:id')
  findTemplate(@Param('id') id: string) {
    return this.communication.findTemplate(id);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('templates/:id/preview')
  previewTemplate(@Param('id') id: string, @Body() body: PreviewTemplateDto) {
    return this.communication.previewTemplate(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('preferences')
  setPreference(@Body() body: SetPreferenceDto) {
    return this.communication.setPreference(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('preferences/:recipientType/:recipientId')
  findPreferences(@Param('recipientType') recipientType: string, @Param('recipientId') recipientId: string) {
    return this.communication.findPreferences(recipientType, recipientId);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('notifications')
  createNotification(@Body() body: CreateNotificationDto) {
    return this.communication.createNotification(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('notifications')
  findAllNotifications() {
    return this.communication.findAllNotifications();
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('notifications/:id')
  findNotification(@Param('id') id: string) {
    return this.communication.findNotification(id);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('notifications/:id/deliveries')
  findDeliveries(@Param('id') id: string) {
    return this.communication.findDeliveries(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('notifications/:id/send')
  send(@Param('id') id: string) {
    return this.communication.send(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('settings')
  upsertSettings(@Body() body: UpsertSettingsDto) {
    return this.communication.upsertSettings(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('settings')
  findSettings() {
    return this.communication.findSettings();
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('settings/sms-spend')
  smsSpendThisMonth() {
    return this.communication.smsSpendThisMonth();
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('reports')
  createReport(@Body() body: CreateReportDto) {
    return this.communication.createReport(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('reports')
  findAllReports() {
    return this.communication.findAllReports();
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('reports/overdue')
  findOverdueReports() {
    return this.communication.findOverdueReports();
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('reports/:id')
  findReport(@Param('id') id: string) {
    return this.communication.findReport(id);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('reports/:id/acknowledge')
  acknowledgeReport(@Param('id') id: string) {
    return this.communication.acknowledgeReport(id);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('reports/:id/start')
  startReport(@Param('id') id: string) {
    return this.communication.startReport(id);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('reports/:id/evidence')
  attachEvidence(@Param('id') id: string, @Body() body: AttachEvidenceDto) {
    return this.communication.attachEvidence(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('reports/:id/complete')
  completeReport(@Param('id') id: string) {
    return this.communication.completeReport(id);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('reports/:id/reopen')
  reopenReport(@Param('id') id: string) {
    return this.communication.reopenReport(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('reports/:id/escalate')
  escalateReport(@Param('id') id: string, @Body() body: EscalateReportDto) {
    return this.communication.escalateReport(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('reports/:id/comments')
  addComment(@Param('id') id: string, @Body() body: AddCommentDto) {
    return this.communication.addComment(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('reports/:id/comments')
  findComments(@Param('id') id: string) {
    return this.communication.findComments(id);
  }
}
