import { Module } from '@nestjs/common';
import { TeacherAssignmentsModule } from '../teacher-assignments/teacher-assignments.module';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [TeacherAssignmentsModule],
  controllers: [StudentsController],
  providers: [StudentsService],
})
export class StudentsModule {}
