import { Module } from '@nestjs/common';
import { StaffModule } from '../staff/staff.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { CommunicationController } from './communication.controller';
import { CommunicationService } from './communication.service';

@Module({
  imports: [StaffModule, GuardiansModule],
  controllers: [CommunicationController],
  providers: [CommunicationService],
  // Exported so DisciplineModule can call into it directly for guardian
  // contact (FR-COM-050's confidential-sensitivity restriction) instead of
  // reimplementing dispatch — see discipline.service.ts's class header.
  exports: [CommunicationService],
})
export class CommunicationModule {}
