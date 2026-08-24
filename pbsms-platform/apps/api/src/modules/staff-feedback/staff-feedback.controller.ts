import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { StaffFeedbackService } from './staff-feedback.service';
import { CreateStaffFeedbackDto } from './dto/create-staff-feedback.dto';
import { ReviewStaffFeedbackDto } from './dto/review-staff-feedback.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ALL_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';
import { TenantContextStore } from '../../common/tenant/tenant-context';

/** staff-feedback.controller.ts — any authenticated staff member submits
 * (ALL_STAFF); ACADEMIC_ADMIN reviews. findAll() computes "is this caller
 * a reviewer" from their own token roles right here, same pattern
 * finance.controller.ts's canApprove-style checks use inline rather than
 * a second role-groups.ts constant for a one-off distinction. */
@Controller('v1/staff-feedback')
export class StaffFeedbackController {
  constructor(private readonly feedback: StaffFeedbackService) {}

  @Roles(...ALL_STAFF)
  @Post()
  create(@Body() body: CreateStaffFeedbackDto) {
    return this.feedback.create(body);
  }

  @Roles(...ALL_STAFF)
  @Get()
  findAll() {
    const { roles } = TenantContextStore.current();
    const isReviewer = roles.some((r) => (ACADEMIC_ADMIN as readonly string[]).includes(r));
    return this.feedback.findAll(isReviewer);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/accept')
  accept(@Param('id') id: string, @Body() body: ReviewStaffFeedbackDto) {
    return this.feedback.accept(id, body.adminNotes);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() body: ReviewStaffFeedbackDto) {
    return this.feedback.reject(id, body.adminNotes);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/hold')
  hold(@Param('id') id: string, @Body() body: ReviewStaffFeedbackDto) {
    return this.feedback.hold(id, body.adminNotes);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/reopen')
  reopen(@Param('id') id: string, @Body() body: ReviewStaffFeedbackDto) {
    return this.feedback.reopen(id, body.adminNotes);
  }
}
