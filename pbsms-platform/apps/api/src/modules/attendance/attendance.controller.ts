import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { SyncAttendanceDto } from './dto/sync-attendance.dto';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';
import { ResolveConflictDto } from './dto/resolve-conflict.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';

/** attendance.controller.ts — SRS Chapter 18. Teachers mark/correct their
 * own attendance day to day (ACADEMIC_STAFF); resolving an offline-sync
 * conflict (FR-ATT-011's different-user-surfaced-for-reconciliation case)
 * is an oversight function reserved for ACADEMIC_ADMIN. Chapter 13.3
 * "assigned students" scope is enforced inside sync()/applyEntry() itself
 * (a plain teacher can only mark attendance for a class they hold an
 * active teacher_assignments row for; ACADEMIC_ADMIN overrides), not
 * here — this only gates by role, same layering FR-ASM-020's score entry
 * already uses. */
@Controller('v1/attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Roles(...ACADEMIC_STAFF)
  @Post('sync')
  sync(@Body() body: SyncAttendanceDto) {
    return this.attendance.sync(body.entries);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get()
  findAll() {
    return this.attendance.findAll();
  }

  @Roles(...ACADEMIC_ADMIN)
  @Get('conflicts')
  findConflicts() {
    return this.attendance.findConflicts();
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('conflicts/:id/resolve')
  resolveConflict(@Param('id') id: string, @Body() body: ResolveConflictDto) {
    return this.attendance.resolveConflict(id, body.resolution);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.attendance.findOne(id);
  }

  @Roles(...ACADEMIC_STAFF)
  @Patch(':id/correct')
  correct(@Param('id') id: string, @Body() body: CorrectAttendanceDto) {
    return this.attendance.correct(id, body.status, body.reason);
  }
}
