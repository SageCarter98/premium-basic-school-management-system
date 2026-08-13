import { Module } from '@nestjs/common';
import { StaffModule } from '../staff/staff.module';
import { DelegationsController } from './delegations.controller';
import { DelegationsService } from './delegations.service';

@Module({
  imports: [StaffModule],
  controllers: [DelegationsController],
  providers: [DelegationsService],
})
export class DelegationsModule {}
