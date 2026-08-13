import { Controller, Get, Param, Query } from '@nestjs/common';
import { StaffService } from './staff.service';
import { Roles } from '../../common/auth/roles.decorator';
import { ALL_STAFF } from '../../common/auth/role-groups';

/** staff.controller.ts — the real staff/role directory (see
 * staff.service.ts's header). ALL_STAFF for both endpoints: looking up a
 * colleague by role is exactly the kind of thing every staff tier
 * plausibly needs (a librarian finding "who's the current Health
 * Officer" to route a query, an accountant finding a specific teacher),
 * same reasoning as students/schools/classes' own ALL_STAFF read tier. */
@Controller('v1/staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Roles(...ALL_STAFF)
  @Get()
  findAll(@Query('role') role?: string) {
    return this.staff.findAll(role);
  }

  @Roles(...ALL_STAFF)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.staff.findOne(id);
  }
}
