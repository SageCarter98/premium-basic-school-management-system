import { Module } from '@nestjs/common';
import { ResultsModule } from '../results/results.module';
import { FinanceModule } from '../finance/finance.module';
import { ParentViewController } from './parent-view.controller';
import { ParentViewService } from './parent-view.service';

@Module({
  imports: [ResultsModule, FinanceModule],
  controllers: [ParentViewController],
  providers: [ParentViewService],
})
export class ParentViewModule {}
