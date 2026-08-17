import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { StaffModule } from '../staff/staff.module';
import { DataProtectionController } from './data-protection.controller';
import { DataProtectionService } from './data-protection.service';
import { DataBreachController } from './data-breach.controller';
import { DataBreachService } from './data-breach.service';

@Module({
  imports: [CommunicationModule, StaffModule],
  controllers: [DataProtectionController, DataBreachController],
  providers: [DataProtectionService, DataBreachService],
})
export class DataProtectionModule {}
