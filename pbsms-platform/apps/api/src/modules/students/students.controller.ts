import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ALL_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';

/**
 * students.controller.ts
 *
 * FR-STU-010..060 (SRS Chapter 16). Role tiers (Chapter 13.2) via
 * RolesGuard/@Roles() — Chapter 13.3's finer record-relationship scope
 * (assigned students / linked children / record ownership) is still a
 * later-pass item, same deferral as every other controller retrofitted in
 * this pass; see role-groups.ts's header.
 */
@Controller('v1/students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Roles(...ALL_STAFF)
  @Get()
  findAll(
    @Query('schoolId') schoolId?: string,
    @Query('classId') classId?: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.students.findAll({ schoolId, classId, academicYearId });
  }

  @Roles(...ALL_STAFF)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.students.findOne(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post()
  create(@Body() body: CreateStudentDto) {
    return this.students.create(body);
  }
}
