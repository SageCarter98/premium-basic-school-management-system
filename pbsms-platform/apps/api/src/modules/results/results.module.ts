import { Module } from '@nestjs/common';
import { TeacherAssignmentsModule } from '../teacher-assignments/teacher-assignments.module';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

@Module({
  imports: [TeacherAssignmentsModule],
  controllers: [ResultsController],
  providers: [ResultsService],
})
export class ResultsModule {}
