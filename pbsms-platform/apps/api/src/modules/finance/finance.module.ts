import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

// FinanceService is exported so parent-view.module.ts (Stage 6) can reuse
// findInvoiceBalance() — its reversal-exclusion/cancelled-invoice logic is
// genuinely non-trivial (see that method's own header) and re-deriving it
// a second time for the parent-facing balance would risk the two drifting
// apart. Same pattern results.module.ts's export follows.
@Module({
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
