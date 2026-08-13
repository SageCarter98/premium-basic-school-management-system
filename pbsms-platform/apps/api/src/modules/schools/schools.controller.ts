import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { CreateSchoolDto } from './dto/create-school.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ALL_STAFF, LEADERSHIP } from '../../common/auth/role-groups';

/**
 * schools.controller.ts
 *
 * FR-* from SRS Chapter 17 onward. Adding a school within a tenant is a
 * LEADERSHIP-only decision (a group's Proprietor adding a campus), not an
 * ACADEMIC_ADMIN one, unlike classes/academic-years below it.
 */
@Controller('v1/schools')
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Roles(...ALL_STAFF)
  @Get()
  findAll() {
    return this.schools.findAll();
  }

  @Roles(...ALL_STAFF)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.schools.findOne(id);
  }

  @Roles(...LEADERSHIP)
  @Post()
  create(@Body() body: CreateSchoolDto) {
    return this.schools.create(body);
  }
}
