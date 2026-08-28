import { Body, Controller, Post } from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_STAFF } from '../../common/auth/role-groups';
import { AssistantRetrievalService } from './assistant-retrieval.service';
import { FindLowAttendanceDto } from './dto/find-low-attendance.dto';

/**
 * Chapter 47 stage 1 (§47.0.2): thin HTTP wiring only. Role-gated the same
 * as attendance itself (ACADEMIC_STAFF) — the Assistant cannot see more
 * than the caller could already see directly through the ordinary
 * attendance endpoints. All scope enforcement lives in the service this
 * controller calls, not here.
 */
@Controller('v1/assistant/retrieve')
export class AssistantRetrievalController {
  constructor(private readonly retrieval: AssistantRetrievalService) {}

  @Roles(...ACADEMIC_STAFF)
  @Post('attendance-below-threshold')
  findLowAttendance(@Body() body: FindLowAttendanceDto) {
    return this.retrieval.findLowAttendance(body);
  }
}
