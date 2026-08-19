import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DataProtectionService } from './data-protection.service';
import { CreateDataSubjectRequestDto } from './dto/create-data-subject-request.dto';
import { AssignRequestDto } from './dto/assign-request.dto';
import { FulfillRequestDto } from './dto/fulfill-request.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { RecordConsentDto } from './dto/record-consent.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_STAFF, LEADERSHIP } from '../../common/auth/role-groups';

/** data-protection.controller.ts — Chapter 39-40. Reading the data
 * inventory/retention schedule and recording consent are routine staff
 * actions (ACADEMIC_STAFF, e.g. capturing a guardian's consent at
 * enrolment). Data subject requests and the retention eligibility report
 * are compliance-sensitive — gated to LEADERSHIP (DP-030 routes these "to
 * the correct tenant's administrator" specifically), not the broader
 * ACADEMIC_ADMIN tier other structural-config endpoints use. */
@Controller('v1/data-protection')
export class DataProtectionController {
  constructor(private readonly dataProtection: DataProtectionService) {}

  @Roles(...ACADEMIC_STAFF)
  @Get('inventory')
  findDataInventory() {
    return this.dataProtection.findDataInventory();
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('retention-policies')
  findRetentionPolicies() {
    return this.dataProtection.findRetentionPolicies();
  }

  @Roles(...LEADERSHIP)
  @Get('retention-eligibility-report')
  retentionEligibilityReport() {
    return this.dataProtection.retentionEligibilityReport();
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('requests')
  createRequest(@Body() body: CreateDataSubjectRequestDto) {
    return this.dataProtection.createRequest(body);
  }

  @Roles(...LEADERSHIP)
  @Get('requests')
  findAllRequests(@Query('status') status?: string) {
    return this.dataProtection.findAllRequests(status);
  }

  // Registered before 'requests/:id' — same path depth, and a literal
  // segment must be matched before a param route can shadow it.
  @Roles(...LEADERSHIP)
  @Get('requests/overdue')
  findOverdueRequests() {
    return this.dataProtection.findOverdueRequests();
  }

  @Roles(...LEADERSHIP)
  @Get('requests/:id')
  findOneRequest(@Param('id') id: string) {
    return this.dataProtection.findOneRequest(id);
  }

  @Roles(...LEADERSHIP)
  @Post('requests/:id/assign')
  assignRequest(@Param('id') id: string, @Body() body: AssignRequestDto) {
    return this.dataProtection.assignRequest(id, body.assigneeUserId);
  }

  @Roles(...LEADERSHIP)
  @Post('requests/:id/fulfill')
  fulfillRequest(@Param('id') id: string, @Body() body: FulfillRequestDto) {
    return this.dataProtection.fulfillRequest(id, body);
  }

  @Roles(...LEADERSHIP)
  @Post('requests/:id/reject')
  rejectRequest(@Param('id') id: string, @Body() body: RejectRequestDto) {
    return this.dataProtection.rejectRequest(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('consent')
  recordConsent(@Body() body: RecordConsentDto) {
    return this.dataProtection.recordConsent(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('consent/:subjectType/:subjectId')
  findCurrentConsent(@Param('subjectType') subjectType: string, @Param('subjectId') subjectId: string) {
    return this.dataProtection.findCurrentConsent(subjectType, subjectId);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('consent/:subjectType/:subjectId/history')
  findConsentHistory(@Param('subjectType') subjectType: string, @Param('subjectId') subjectId: string) {
    return this.dataProtection.findConsentHistory(subjectType, subjectId);
  }

  @Roles(...LEADERSHIP)
  @Get('audit-log')
  findAuditLog(@Query('actorUserId') actorUserId?: string, @Query('action') action?: string) {
    return this.dataProtection.findAuditLog({ actorUserId, action });
  }
}
