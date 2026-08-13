import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { StaffModule } from '../staff/staff.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [CommunicationModule, StaffModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
