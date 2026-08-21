import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TeacherAssignmentsService } from './teacher-assignments.service';
import { CreateTeacherAssignmentDto } from './dto/create-teacher-assignment.dto';
import { EndTeacherAssignmentDto } from './dto/end-teacher-assignment.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_ADMIN, ACADEMIC_STAFF } from '../../common/auth/role-groups';

/**
 * teacher-assignments.controller.ts — Chapter 17.1. Assigning/ending a
 * teacher's class-subject responsibility is an academic-office function
 * (ACADEMIC_ADMIN), same tier as assessment structural configuration;
 * reading assignments is broad ACADEMIC_STAFF, record-scoped in the
 * service layer — a non-admin caller only ever sees their own
 * assignments (findAll() overrides any teacherId filter, findOne()
 * 403s on someone else's), closing what was previously a deferred
 * Chapter 13.3 gap.
 */
@Controller('v1/teacher-assignments')
export class TeacherAssignmentsController {
  constructor(private readonly teacherAssignments: TeacherAssignmentsService) {}

  @Roles(...ACADEMIC_ADMIN)
  @Post()
  assign(@Body() body: CreateTeacherAssignmentDto) {
    return this.teacherAssignments.assign(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get()
  findAll(
    @Query('teacherId') teacherId?: string,
    @Query('classId') classId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.teacherAssignments.findAll({ teacherId, classId, subjectId, academicYearId });
  }

  // Declared before ':id' — Nest matches routes in registration order,
  // and 'class-teacher' would otherwise be swallowed as an :id value.
  @Roles(...ACADEMIC_STAFF)
  @Get('class-teacher')
  findClassTeacher(@Query('classId') classId: string, @Query('academicYearId') academicYearId: string) {
    return this.teacherAssignments.findClassTeacher(classId, academicYearId);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.teacherAssignments.findOne(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/end')
  end(@Param('id') id: string, @Body() body: EndTeacherAssignmentDto) {
    return this.teacherAssignments.end(id, body.reason);
  }
}
