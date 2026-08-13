import { Module } from '@nestjs/common';
import { TeacherAssignmentsController } from './teacher-assignments.controller';
import { TeacherAssignmentsService } from './teacher-assignments.service';

/** TeacherAssignmentsService is exported so assessment.module.ts can
 * inject it to enforce FR-ASM-020 in upsertScore() — see
 * teacher-assignments.service.ts's hasActiveAssignment(). */
@Module({
  controllers: [TeacherAssignmentsController],
  providers: [TeacherAssignmentsService],
  exports: [TeacherAssignmentsService],
})
export class TeacherAssignmentsModule {}
