import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NaccaService } from './nacca.service';
import { UpsertAcademicSettingsDto } from './dto/upsert-academic-settings.dto';
import { CreateStrandDto } from './dto/create-strand.dto';
import { CreateSubStrandDto } from './dto/create-sub-strand.dto';
import { CreateIndicatorDto } from './dto/create-indicator.dto';
import { RegisterCandidateDto } from './dto/register-candidate.dto';
import { RecordMockResultDto } from './dto/record-mock-result.dto';
import { RecordCsspsPlacementDto } from './dto/record-cssps-placement.dto';
import { ConfirmPlacementDto } from './dto/confirm-placement.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_ADMIN, ACADEMIC_STAFF } from '../../common/auth/role-groups';

/** nacca.controller.ts — Chapter 41. Curriculum/settings structural
 * config, BECE candidate registration and GES statutory reports are
 * ACADEMIC_ADMIN (examination_officer, part of that tier, is the
 * Chapter-3.2 role this maps onto most directly); day-to-day reads and
 * mock-result entry are ACADEMIC_STAFF, same broad tier every other
 * module's routine staff actions use. */
@Controller('v1/nacca')
export class NaccaController {
  constructor(private readonly nacca: NaccaService) {}

  @Roles(...ACADEMIC_ADMIN)
  @Post('academic-settings')
  upsertAcademicSettings(@Body() body: UpsertAcademicSettingsDto) {
    return this.nacca.upsertAcademicSettings(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('academic-settings/:schoolId')
  findAcademicSettings(@Param('schoolId') schoolId: string) {
    return this.nacca.findAcademicSettings(schoolId);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('strands')
  createStrand(@Body() body: CreateStrandDto) {
    return this.nacca.createStrand(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('strands')
  findStrands(@Query('subjectId') subjectId?: string) {
    return this.nacca.findStrands(subjectId);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('sub-strands')
  createSubStrand(@Body() body: CreateSubStrandDto) {
    return this.nacca.createSubStrand(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('strands/:strandId/sub-strands')
  findSubStrands(@Param('strandId') strandId: string) {
    return this.nacca.findSubStrands(strandId);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('indicators')
  createIndicator(@Body() body: CreateIndicatorDto) {
    return this.nacca.createIndicator(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('sub-strands/:subStrandId/indicators')
  findIndicators(@Param('subStrandId') subStrandId: string) {
    return this.nacca.findIndicators(subStrandId);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('coverage-report')
  coverageReport(
    @Query('classId') classId: string,
    @Query('subjectId') subjectId: string,
    @Query('academicYearId') academicYearId: string,
  ) {
    return this.nacca.coverageReport(classId, subjectId, academicYearId);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('students/:studentId/competency-profile')
  competencyProfile(
    @Param('studentId') studentId: string,
    @Query('subjectId') subjectId: string,
    @Query('academicYearId') academicYearId: string,
  ) {
    return this.nacca.competencyProfile(studentId, subjectId, academicYearId);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('bece/candidates')
  registerCandidate(@Body() body: RegisterCandidateDto) {
    return this.nacca.registerCandidate(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('bece/candidates')
  findCandidates(@Query('academicYearId') academicYearId?: string) {
    return this.nacca.findCandidates(academicYearId);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('bece/candidates/:id')
  findOneCandidate(@Param('id') id: string) {
    return this.nacca.findOneCandidate(id);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('bece/mock-results')
  recordMockResult(@Body() body: RecordMockResultDto) {
    return this.nacca.recordMockResult(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('bece/candidates/:id/mock-results')
  findMockResults(@Param('id') id: string, @Query('examSession') examSession: string) {
    return this.nacca.findMockResults(id, examSession);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('bece/candidates/:id/aggregate')
  aggregate(@Param('id') id: string, @Query('examSession') examSession: string) {
    return this.nacca.aggregate(id, examSession);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('bece/candidates/:id/readiness')
  readinessAnalytics(@Param('id') id: string, @Query('examSession') examSession: string) {
    return this.nacca.readinessAnalytics(id, examSession);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Get('ges/enrolment-census')
  enrolmentCensus(@Query('academicYearId') academicYearId: string) {
    return this.nacca.enrolmentCensus(academicYearId);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Get('ges/attendance-returns')
  attendanceReturns(
    @Query('classId') classId: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
  ) {
    return this.nacca.attendanceReturns(classId, periodStart, periodEnd);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('cssps/placements')
  recordPlacement(@Body() body: RecordCsspsPlacementDto) {
    return this.nacca.recordPlacement(body);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('cssps/placements/:studentId/confirm')
  confirmPlacement(@Param('studentId') studentId: string, @Body() body: ConfirmPlacementDto) {
    return this.nacca.confirmPlacement(studentId, body.placementOutcome);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('cssps/placements/:studentId')
  findPlacement(@Param('studentId') studentId: string) {
    return this.nacca.findPlacement(studentId);
  }
}
