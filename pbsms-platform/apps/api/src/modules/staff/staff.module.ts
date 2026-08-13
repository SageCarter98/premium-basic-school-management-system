import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

/** StaffService is exported so other modules (discipline, health,
 * inventory, communication) can inject it to validate a polymorphic
 * recipientType/issuedToType === 'staff' id — see staff.service.ts's
 * isRealStaffMember() and 0018_staff_directory.sql's header. */
@Module({
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
