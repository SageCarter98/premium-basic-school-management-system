import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { HealthService } from './health.service';
import { UpsertRecordDto } from './dto/upsert-record.dto';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { ContactGuardianDto } from './dto/contact-guardian.dto';
import { LogMedicationDto } from './dto/log-medication.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { HEALTH_TEAM } from '../../common/auth/role-groups';

/** health.controller.ts — SRS Chapter 28 (FR-OPS-030). HEALTH_TEAM
 * (LEADERSHIP + 'health_officer') for every endpoint — the
 * restricted-access requirement FR-STU-040 explicitly calls for
 * (0014_health.sql's header) makes least-privilege the right default
 * here even more than library/transport/inventory, not less. Full
 * record-relationship scoping (Chapter 13.3) is still a later-pass item;
 * this is role-tier only. */
@Controller('v1/health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Roles(...HEALTH_TEAM)
  @Post('records')
  upsertRecord(@Body() body: UpsertRecordDto) {
    return this.health.upsertRecord(body);
  }

  @Roles(...HEALTH_TEAM)
  @Get('records/by-student/:studentId')
  findRecordByStudent(@Param('studentId') studentId: string) {
    return this.health.findRecordByStudent(studentId);
  }

  @Roles(...HEALTH_TEAM)
  @Post('incidents')
  createIncident(@Body() body: CreateIncidentDto) {
    return this.health.createIncident(body);
  }

  @Roles(...HEALTH_TEAM)
  @Get('incidents')
  findAllIncidents() {
    return this.health.findAllIncidents();
  }

  @Roles(...HEALTH_TEAM)
  @Get('incidents/:id')
  findIncident(@Param('id') id: string) {
    return this.health.findIncident(id);
  }

  @Roles(...HEALTH_TEAM)
  @Post('incidents/:id/resolve')
  resolveIncident(@Param('id') id: string) {
    return this.health.resolveIncident(id);
  }

  @Roles(...HEALTH_TEAM)
  @Post('incidents/:id/reopen')
  reopenIncident(@Param('id') id: string) {
    return this.health.reopenIncident(id);
  }

  @Roles(...HEALTH_TEAM)
  @Post('incidents/:id/guardian-contacts')
  contactGuardian(@Param('id') id: string, @Body() body: ContactGuardianDto) {
    return this.health.contactGuardian(id, body);
  }

  @Roles(...HEALTH_TEAM)
  @Get('incidents/:id/guardian-contacts')
  findGuardianContacts(@Param('id') id: string) {
    return this.health.findGuardianContacts(id);
  }

  @Roles(...HEALTH_TEAM)
  @Post('medication-log')
  logMedication(@Body() body: LogMedicationDto) {
    return this.health.logMedication(body);
  }

  @Roles(...HEALTH_TEAM)
  @Get('medication-log/by-student/:studentId')
  findMedicationLogByStudent(@Param('studentId') studentId: string) {
    return this.health.findMedicationLogByStudent(studentId);
  }
}
