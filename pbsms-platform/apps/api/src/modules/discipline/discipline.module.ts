import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { StaffModule } from '../staff/staff.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { TeacherAssignmentsModule } from '../teacher-assignments/teacher-assignments.module';
import { DisciplineController } from './discipline.controller';
import { DisciplineService } from './discipline.service';

@Module({
  imports: [CommunicationModule, StaffModule, GuardiansModule, TeacherAssignmentsModule],
  controllers: [DisciplineController],
  providers: [DisciplineService],
})
export class DisciplineModule {}
