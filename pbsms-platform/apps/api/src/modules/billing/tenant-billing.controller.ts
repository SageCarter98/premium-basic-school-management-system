import { Controller, Get } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { Roles } from '../../common/auth/roles.decorator';
import { LEADERSHIP } from '../../common/auth/role-groups';

/**
 * tenant-billing.controller.ts — TEN-031's tenant-facing half: "MUST
 * make the current [metered] count and the resulting projected bill
 * visible to the tenant's Proprietor/Administrator role at any time —
 * no surprise invoices." Ordinary /v1/billing route (NOT /v1/platform/),
 * uses TenantDatabaseService like every other tenant-facing controller —
 * tenant_billing_summary() (0024_billing.sql) is a SECURITY DEFINER
 * function scoped to current_tenant_id() internally, so this can never
 * leak another tenant's billing data no matter what.
 */
@Controller('v1/billing')
export class TenantBillingController {
  constructor(private readonly db: TenantDatabaseService) {}

  @Roles(...LEADERSHIP)
  @Get('summary')
  async summary() {
    const rows = await this.db.query(`select * from tenant_billing_summary()`);
    return rows[0] ?? null;
  }
}
