import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { StaffModule } from '../staff/staff.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [CommunicationModule, StaffModule, GuardiansModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
