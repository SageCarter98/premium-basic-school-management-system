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
 * reading assignments is broad ACADEMIC_STAFF (role-gated only, no
 * record-scoping — a teacher can currently see every assignment, not just
 * their own, same deferred-to-Chapter-13.3 posture as every other module).
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
