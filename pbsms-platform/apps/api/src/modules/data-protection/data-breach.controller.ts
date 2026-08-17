import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DataBreachService } from './data-breach.service';
import { ReportBreachDto } from './dto/report-breach.dto';
import { AssessBreachDto } from './dto/assess-breach.dto';
import { PlatformRoles } from '../../common/auth/platform-roles.decorator';
import { PLATFORM_ALL, PLATFORM_SUPER_ADMIN } from '../../common/auth/platform-role-groups';
import { PlatformContextStore } from '../../common/tenant/platform-context';

/** data-breach.controller.ts — DP-040. Reporting/assessing/filing a real
 * personal-data breach is high-stakes enough to gate at
 * PLATFORM_SUPER_ADMIN specifically (the same "break-glass" seriousness
 * Chapter 3.1 reserves for granting platform roles), not the broader
 * PLATFORM_ALL tier other platform actions use — read access stays
 * PLATFORM_ALL so Support Engineers can see incident status. */
@Controller('v1/platform/data-breach-incidents')
export class DataBreachController {
  constructor(private readonly breaches: DataBreachService) {}

  @PlatformRoles(...PLATFORM_SUPER_ADMIN)
  @Post()
  report(@Body() body: ReportBreachDto) {
    const { userId } = PlatformContextStore.current();
    return this.breaches.report(userId, body);
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Get()
  findAll() {
    return this.breaches.findAll();
  }

  @PlatformRoles(...PLATFORM_ALL)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.breaches.findOne(id);
  }

  @PlatformRoles(...PLATFORM_SUPER_ADMIN)
  @Post(':id/assess')
  assess(@Param('id') id: string, @Body() body: AssessBreachDto) {
    const { userId } = PlatformContextStore.current();
    return this.breaches.assess(userId, id, body.meetsStatutoryThreshold);
  }

  @PlatformRoles(...PLATFORM_SUPER_ADMIN)
  @Post(':id/report-to-dpc')
  reportToDpc(@Param('id') id: string) {
    return this.breaches.reportToDpc(id);
  }

  @PlatformRoles(...PLATFORM_SUPER_ADMIN)
  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.breaches.close(id);
  }
}
