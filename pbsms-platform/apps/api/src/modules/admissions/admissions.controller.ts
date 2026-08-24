import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AdmissionsService } from './admissions.service';
import { CreateApplicantDto } from './dto/create-applicant.dto';
import { UpdateApplicantStatusDto } from './dto/update-applicant-status.dto';
import { UpdateApplicantIntakeDto } from './dto/update-applicant-intake.dto';
import { ConvertApplicantDto } from './dto/convert-applicant.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ALL_STAFF, ADMISSIONS_TEAM } from '../../common/auth/role-groups';

/** admissions.controller.ts — SRS Chapter 15. `admission_officer` is
 * Chapter 3.2's literal role for this domain — ADMISSIONS_TEAM
 * (LEADERSHIP + admission_officer) covers the whole applicant lifecycle
 * including convert() (FR-ADM-030's atomic applicant→student transition). */
@Controller('v1/admissions')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Roles(...ALL_STAFF)
  @Get()
  findAll() {
    return this.admissions.findAll();
  }

  @Roles(...ALL_STAFF)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.admissions.findOne(id);
  }

  @Roles(...ADMISSIONS_TEAM)
  @Post()
  create(@Body() body: CreateApplicantDto) {
    return this.admissions.create(body);
  }

  @Roles(...ADMISSIONS_TEAM)
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: UpdateApplicantStatusDto) {
    return this.admissions.updateStatus(id, body.status);
  }

  @Roles(...ADMISSIONS_TEAM)
  @Patch(':id/intake')
  updateIntake(@Param('id') id: string, @Body() body: UpdateApplicantIntakeDto) {
    return this.admissions.updateIntake(id, body);
  }

  @Roles(...ADMISSIONS_TEAM)
  @Post(':id/convert')
  convert(@Param('id') id: string, @Body() body: ConvertApplicantDto) {
    return this.admissions.convert(id, body);
  }
}
