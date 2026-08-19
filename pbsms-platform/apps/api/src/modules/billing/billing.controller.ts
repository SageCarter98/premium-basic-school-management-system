import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { BillingService } from './billing.service';
import { AssignPlanDto } from './dto/assign-plan.dto';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { RecordInvoicePaymentDto } from './dto/record-invoice-payment.dto';
import { DunningStepDto } from './dto/dunning-step.dto';
import { PlatformRoles } from '../../common/auth/platform-roles.decorator';
import { PLATFORM_BILLING, PLATFORM_ALL } from '../../common/auth/platform-role-groups';
import { PlatformContextStore } from '../../common/tenant/platform-context';

/** billing.controller.ts — Chapter 5. Billing Administrator (Chapter 3.1:
 * "manage subscriptions, invoicing of tenants, dunning") owns writes;
 * reads are open to any platform role, same broad-read/narrow-write split
 * every other platform controller here uses. */
@Controller('v1/platform/billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // Stage 9 additions — the spec's "Plan & pricing configuration" and
  // "Metering & usage" Platform Console screens had no read endpoint to
  // populate them from at all (plans stay seed-configured, no CRUD, per
  // this file's own header; count_active_students() existed only as an
  // internal helper inside generateInvoice()). Both are thin, read-only
  // wraps of data/functions that already existed — no new mechanism.
  @PlatformRoles(...PLATFORM_ALL)
  @Get('plans')
  listPlans() {
    return this.billing.listPlans();
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Get('metering')
  metering() {
    return this.billing.metering();
  }

  @PlatformRoles(...PLATFORM_BILLING)
  @Post('tenants/:tenantId/plan')
  assignPlan(@Param('tenantId') tenantId: string, @Body() body: AssignPlanDto) {
    const { userId } = PlatformContextStore.current();
    return this.billing.assignPlan(userId, tenantId, body.planId, body.billingCycle);
  }

  @PlatformRoles(...PLATFORM_BILLING)
  @Post('tenants/:tenantId/invoices')
  generateInvoice(@Param('tenantId') tenantId: string, @Body() body: GenerateInvoiceDto) {
    const { userId } = PlatformContextStore.current();
    return this.billing.generateInvoice(userId, tenantId, body.periodStart, body.periodEnd);
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Get('invoices')
  listInvoices(@Query('tenantId') tenantId?: string, @Query('status') status?: string) {
    return this.billing.listInvoices({ tenantId, status });
  }

  @PlatformRoles(...PLATFORM_BILLING)
  @Post('invoices/:invoiceId/pay')
  recordPayment(@Param('invoiceId') invoiceId: string, @Body() body: RecordInvoicePaymentDto) {
    const { userId } = PlatformContextStore.current();
    return this.billing.recordInvoicePayment(userId, invoiceId, body.reference);
  }

  @PlatformRoles(...PLATFORM_BILLING)
  @Post('invoices/:invoiceId/mark-overdue')
  markOverdue(@Param('invoiceId') invoiceId: string) {
    const { userId } = PlatformContextStore.current();
    return this.billing.markInvoiceOverdue(userId, invoiceId);
  }

  @PlatformRoles(...PLATFORM_BILLING)
  @Post('tenants/:tenantId/dunning/advance')
  runDunningStep(@Param('tenantId') tenantId: string, @Body() body: DunningStepDto) {
    const { userId } = PlatformContextStore.current();
    return this.billing.runDunningStep(userId, tenantId, body.reason);
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Get('revenue-report')
  revenueReport(@Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    return this.billing.revenueReport(periodStart, periodEnd);
  }
}
