import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { StaffService } from './staff.service';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ALL_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';

/** staff.controller.ts — the real staff/role directory (see
 * staff.service.ts's header). ALL_STAFF for both read endpoints: looking
 * up a colleague by role is exactly the kind of thing every staff tier
 * plausibly needs (a librarian finding "who's the current Health
 * Officer" to route a query, an accountant finding a specific teacher),
 * same reasoning as students/schools/classes' own ALL_STAFF read tier.
 * Inviting a new staff member — creating a real login — is ACADEMIC_ADMIN,
 * the same senior/structural-configuration tier every other "bring a new
 * thing into existence" action in this codebase uses (no dedicated HR
 * role exists in Chapter 3.2, same reasoning discipline.controller.ts
 * already applied for its own missing 'Discipline Officer' tier). */
@Controller('v1/staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Roles(...ALL_STAFF)
  @Get()
  findAll(@Query('role') role?: string) {
    return this.staff.findAll(role);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('invite')
  inviteStaff(@Body() body: InviteStaffDto) {
    return this.staff.inviteStaff(body);
  }

  @Roles(...ALL_STAFF)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.staff.findOne(id);
  }
}
