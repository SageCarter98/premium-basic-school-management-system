import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { ResultsModule } from '../results/results.module';
import { DisciplineModule } from '../discipline/discipline.module';
import { HealthModule } from '../health/health.module';
import { FinanceModule } from '../finance/finance.module';
import { TimelineController } from './timeline.controller';
import { TimelineService } from './timeline.service';

@Module({
  imports: [AttendanceModule, ResultsModule, DisciplineModule, HealthModule, FinanceModule],
  controllers: [TimelineController],
  providers: [TimelineService],
})
export class TimelineModule {}
