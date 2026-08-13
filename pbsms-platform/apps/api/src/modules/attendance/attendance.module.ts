import { Module } from '@nestjs/common';
import { TeacherAssignmentsModule } from '../teacher-assignments/teacher-assignments.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [TeacherAssignmentsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
