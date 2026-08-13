import { Module } from '@nestjs/common';
import { EnrolmentsController } from './enrolments.controller';
import { EnrolmentsService } from './enrolments.service';

@Module({
  controllers: [EnrolmentsController],
  providers: [EnrolmentsService],
})
export class EnrolmentsModule {}
