import { Controller, Get, Param } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { Roles } from '../../common/auth/roles.decorator';
import { ALL_STAFF } from '../../common/auth/role-groups';

// Gated the same as students.controller.ts's own read endpoint — per-event
// filtering by the caller's actual tier happens inside TimelineService,
// same split students/guardians already use between "can reach this
// route" and "which rows come back."
@Controller('v1')
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Roles(...ALL_STAFF)
  @Get('students/:studentId/timeline')
  getTimeline(@Param('studentId') studentId: string) {
    return this.timeline.getTimeline(studentId);
  }
}
