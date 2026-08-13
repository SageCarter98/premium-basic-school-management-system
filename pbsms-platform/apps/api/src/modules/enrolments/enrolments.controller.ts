import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { EnrolmentsService } from './enrolments.service';
import { CreateEnrolmentDto } from './dto/create-enrolment.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ALL_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';

/** enrolments.controller.ts — SRS Chapter 16/17. */
@Controller('v1/enrolments')
export class EnrolmentsController {
  constructor(private readonly enrolments: EnrolmentsService) {}

  @Roles(...ALL_STAFF)
  @Get()
  findAll() {
    return this.enrolments.findAll();
  }

  @Roles(...ALL_STAFF)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.enrolments.findOne(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post()
  create(@Body() body: CreateEnrolmentDto) {
    return this.enrolments.create(body);
  }
}
