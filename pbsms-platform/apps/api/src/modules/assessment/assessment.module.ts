import { Module } from '@nestjs/common';
import { TeacherAssignmentsModule } from '../teacher-assignments/teacher-assignments.module';
import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';

@Module({
  imports: [TeacherAssignmentsModule],
  controllers: [AssessmentController],
  providers: [AssessmentService],
})
export class AssessmentModule {}
