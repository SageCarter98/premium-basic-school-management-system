import { Controller, Get, Param, Query } from '@nestjs/common';
import { ParentViewService } from './parent-view.service';

/**
 * parent-view.controller.ts — Stage 6. Deliberately carries NO @Roles()
 * decorators: RolesGuard is unrestricted-by-default (see role-groups.ts's
 * own header on every other controller), and the only requests that ever
 * reach here with a resolved TenantContextStore already passed
 * tenant.middleware.ts's PARENT_PATH_PREFIX token check — there is no
 * separate role tier to enforce on top of "does this token verify."
 * GET-only by design (spec §8.6/§8.7 are read screens; nothing here
 * mutates), which also means AuditLogInterceptor never logs these calls
 * (it only logs non-GET) — see tenant-context.ts's guardianId doc comment
 * for why that matters (audit_log.actor_user_id's FK to users(id) would
 * reject a raw guardian id).
 */
@Controller('v1/parent')
export class ParentViewController {
  constructor(private readonly parentView: ParentViewService) {}

  @Get('home')
  getHome() {
    return this.parentView.getHome();
  }

  @Get('students/:studentId/report-card')
  getReportCard(@Param('studentId') studentId: string, @Query('resultId') resultId?: string) {
    return this.parentView.getReportCard(studentId, resultId);
  }

  @Get('students/:studentId/invoices')
  getInvoices(@Param('studentId') studentId: string) {
    return this.parentView.getInvoices(studentId);
  }
}
