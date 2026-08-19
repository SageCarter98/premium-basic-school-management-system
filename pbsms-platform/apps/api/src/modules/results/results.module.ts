import { Module } from '@nestjs/common';
import { TeacherAssignmentsModule } from '../teacher-assignments/teacher-assignments.module';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

// ResultsService is exported so parent-view.module.ts (Stage 6) can reuse
// findPublishedForStudent()/findItems() rather than re-deriving the
// FR-RES-040 published-only visibility rule a second time — same pattern
// discipline.module.ts's cross-module CommunicationService import
// established first.
@Module({
  imports: [TeacherAssignmentsModule],
  controllers: [ResultsController],
  providers: [ResultsService],
  exports: [ResultsService],
})
export class ResultsModule {}
