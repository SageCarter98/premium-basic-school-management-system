import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ResultsService } from './results.service';
import { CreateStudentResultDto } from './dto/create-student-result.dto';
import { ReturnResultDto } from './dto/return-result.dto';
import { ReopenResultDto } from './dto/reopen-result.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';

/** results.controller.ts — SRS Chapter 21. Two tiers, same shape as
 * finance.controller.ts's read/record/approve split: ACADEMIC_STAFF is
 * the "maker" (submit/correct — the teacher who owns the result),
 * ACADEMIC_ADMIN is the "checker/senior" tier for everything that moves
 * a result through review/approval/publication/archival or reopens a
 * finalized one — who is allowed to call review()/approve()/publish() is
 * exactly Chapter 13's role question this answers. */
@Controller('v1/results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Roles(...ACADEMIC_ADMIN)
  @Post()
  create(@Body() body: CreateStudentResultDto) {
    return this.results.create(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get()
  findAll() {
    return this.results.findAll();
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('students/:studentId')
  findPublishedForStudent(@Param('studentId') studentId: string) {
    return this.results.findPublishedForStudent(studentId);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('classes/:classId/years/:yearId/analytics')
  classAnalytics(@Param('classId') classId: string, @Param('yearId') yearId: string) {
    return this.results.classAnalytics(classId, yearId);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.results.findOne(id);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get(':id/items')
  findItems(@Param('id') id: string) {
    return this.results.findItems(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/resync')
  resync(@Param('id') id: string) {
    return this.results.resync(id);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post(':id/submit')
  submit(@Param('id') id: string) {
    return this.results.submit(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/return')
  returnForCorrection(@Param('id') id: string, @Body() body: ReturnResultDto) {
    return this.results.returnForCorrection(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post(':id/correct')
  correct(@Param('id') id: string) {
    return this.results.correct(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/review')
  review(@Param('id') id: string) {
    return this.results.review(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.results.approve(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/publish')
  publish(@Param('id') id: string) {
    return this.results.publish(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/lock')
  lock(@Param('id') id: string) {
    return this.results.lock(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.results.archive(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/reopen')
  reopen(@Param('id') id: string, @Body() body: ReopenResultDto) {
    return this.results.reopen(id, body);
  }
}
