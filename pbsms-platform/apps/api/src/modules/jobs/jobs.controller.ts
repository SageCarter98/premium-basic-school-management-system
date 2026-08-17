import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_ADMIN, ACADEMIC_STAFF } from '../../common/auth/role-groups';

/** jobs.controller.ts — Chapter 35.1. Requesting a bulk run (report cards
 * for a class, a mass notification) or defining a recurring schedule is a
 * senior/structural operational action (ACADEMIC_ADMIN, same tier as
 * publish/approve steps elsewhere) — it issues official documents or sends
 * bulk communications school-wide. Reading job/schedule status is broad
 * (ACADEMIC_STAFF), same as every other module's read side. */
@Controller('v1/jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Roles(...ACADEMIC_ADMIN)
  @Post()
  enqueue(@Body() body: CreateJobDto) {
    return this.jobs.enqueue(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get()
  findAll(@Query('status') status?: string) {
    return this.jobs.findAll(status);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jobs.findOne(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('schedules')
  createSchedule(@Body() body: CreateScheduleDto) {
    return this.jobs.createSchedule(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('schedules/list')
  findAllSchedules() {
    return this.jobs.findAllSchedules();
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('schedules/:id/deactivate')
  deactivateSchedule(@Param('id') id: string) {
    return this.jobs.deactivateSchedule(id);
  }
}
