import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TimetableService } from './timetable.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { CreatePeriodDto } from './dto/create-period.dto';
import { CreateTimetableEntryDto } from './dto/create-timetable-entry.dto';
import { EndTimetableEntryDto } from './dto/end-timetable-entry.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_ADMIN, ALL_STAFF } from '../../common/auth/role-groups';

/** timetable.controller.ts — Chapter 17 (spec §7.6). Configuring rooms/
 * periods and building the timetable is academic-office work (ACADEMIC_ADMIN,
 * same tier as Academic Structure's other config screens); reading it is
 * broad ALL_STAFF, same as classes/subjects — any staff member plausibly
 * needs to look up when/where a class meets. */
@Controller('v1/timetable')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Roles(...ACADEMIC_ADMIN)
  @Post('rooms')
  createRoom(@Body() body: CreateRoomDto) {
    return this.timetable.createRoom(body);
  }

  @Roles(...ALL_STAFF)
  @Get('rooms')
  findAllRooms() {
    return this.timetable.findAllRooms();
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('periods')
  createPeriod(@Body() body: CreatePeriodDto) {
    return this.timetable.createPeriod(body);
  }

  @Roles(...ALL_STAFF)
  @Get('periods')
  findAllPeriods() {
    return this.timetable.findAllPeriods();
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('entries')
  createEntry(@Body() body: CreateTimetableEntryDto) {
    return this.timetable.createEntry(body);
  }

  @Roles(...ALL_STAFF)
  @Get('entries')
  findAllEntries(
    @Query('academicYearId') academicYearId?: string,
    @Query('classId') classId?: string,
    @Query('teacherId') teacherId?: string,
  ) {
    return this.timetable.findAllEntries({ academicYearId, classId, teacherId });
  }

  @Roles(...ALL_STAFF)
  @Get('entries/:id')
  findOne(@Param('id') id: string) {
    return this.timetable.findOne(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('entries/:id/end')
  end(@Param('id') id: string, @Body() body: EndTimetableEntryDto) {
    return this.timetable.end(id, body.reason);
  }
}
