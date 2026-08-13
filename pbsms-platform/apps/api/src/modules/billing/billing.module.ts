import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { BillingController } from './billing.controller';
import { TenantBillingController } from './tenant-billing.controller';
import { BillingService } from './billing.service';

/** Imports TenantsModule for TenantsService — runDunningStep() drives
 * real tenant status transitions through it rather than duplicating
 * Phase A1's state-machine logic here. */
@Module({
  imports: [TenantsModule],
  controllers: [BillingController, TenantBillingController],
  providers: [BillingService],
})
export class BillingModule {}
