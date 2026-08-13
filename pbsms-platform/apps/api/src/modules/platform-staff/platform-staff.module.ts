import { Module } from '@nestjs/common';
import { PlatformStaffController } from './platform-staff.controller';
import { PlatformStaffService } from './platform-staff.service';

@Module({
  controllers: [PlatformStaffController],
  providers: [PlatformStaffService],
})
export class PlatformStaffModule {}
