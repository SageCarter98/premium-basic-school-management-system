import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { CreateKpiDefinitionDto } from './dto/create-kpi-definition.dto';
import { RecomputeKpiDto } from './dto/recompute-kpi.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_ADMIN, ACADEMIC_STAFF, LEADERSHIP } from '../../common/auth/role-groups';

/** analytics.controller.ts — Chapter 14 (Operational Intelligence) +
 * Chapter 27.1 (trend analysis). Defining/recomputing a KPI is structural
 * operational config (ACADEMIC_ADMIN, same tier as Jobs' schedule
 * creation); reading KPI data and trends is broad (ACADEMIC_STAFF, same
 * as every other module's read side). The group roll-up is gated
 * specifically to LEADERSHIP — FR-ANL-010 names "the Proprietor/Director
 * role" exactly, a narrower ask than the usual ACADEMIC_ADMIN tier. */
@Controller('v1/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Roles(...ACADEMIC_ADMIN)
  @Post('kpis')
  createKpiDefinition(@Body() body: CreateKpiDefinitionDto) {
    return this.analytics.createKpiDefinition(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('kpis')
  findAllKpiDefinitions() {
    return this.analytics.findAllKpiDefinitions();
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('kpis/:id')
  findOneKpiDefinition(@Param('id') id: string) {
    return this.analytics.findOneKpiDefinition(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('kpis/:id/recompute')
  recomputeKpi(@Param('id') id: string, @Body() body: RecomputeKpiDto) {
    return this.analytics.recomputeKpi(id, body.periodStart, body.periodEnd);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('kpis/:id/snapshots')
  findSnapshots(@Param('id') id: string) {
    return this.analytics.findSnapshots(id);
  }

  @Roles(...LEADERSHIP)
  @Get('group-rollup')
  groupRollup(@Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    if (!periodStart || !periodEnd) {
      throw new BadRequestException('periodStart and periodEnd (YYYY-MM-DD) are both required');
    }
    return this.analytics.groupRollup(periodStart, periodEnd);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('trends')
  trends(
    @Query('level') level: string,
    @Query('studentId') studentId?: string,
    @Query('classId') classId?: string,
    @Query('schoolId') schoolId?: string,
    @Query('subjectName') subjectName?: string,
  ) {
    switch (level) {
      case 'student':
        if (!studentId) throw new BadRequestException('studentId is required for level=student');
        return this.analytics.trendsByStudent(studentId);
      case 'class':
        if (!classId) throw new BadRequestException('classId is required for level=class');
        return this.analytics.trendsByClass(classId);
      case 'subject':
        if (!schoolId || !subjectName) throw new BadRequestException('schoolId and subjectName are required for level=subject');
        return this.analytics.trendsBySubject(schoolId, subjectName);
      case 'school':
        if (!schoolId) throw new BadRequestException('schoolId is required for level=school');
        return this.analytics.trendsBySchool(schoolId);
      default:
        throw new BadRequestException("level must be one of: student, class, subject, school (FR-ANL-020's 'division' level has no corresponding entity in this schema)");
    }
  }
}
