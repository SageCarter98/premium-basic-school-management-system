import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { GuardiansService } from './guardians.service';
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { LinkGuardianDto } from './dto/link-guardian.dto';
import { UpdateGuardianLinkDto } from './dto/update-guardian-link.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ALL_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';

/**
 * guardians.controller.ts — FR-STU-020 (SRS Chapter 16.2). Same tier
 * split as students.controller.ts: broad ALL_STAFF read (a librarian or
 * transport officer plausibly needs a guardian's phone number as much as
 * academic staff do — same "cross-cutting reference data" reasoning
 * role-groups.ts's ALL_STAFF already documents), ACADEMIC_ADMIN for the
 * senior/administrative write actions (creating a guardian record,
 * linking/editing/removing a student's guardian relationship).
 */
@Controller('v1')
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Roles(...ALL_STAFF)
  @Get('guardians')
  findAll() {
    return this.guardians.findAll();
  }

  @Roles(...ALL_STAFF)
  @Get('guardians/:id')
  findOne(@Param('id') id: string) {
    return this.guardians.findOne(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('guardians')
  create(@Body() body: CreateGuardianDto) {
    return this.guardians.create(body);
  }

  @Roles(...ALL_STAFF)
  @Get('students/:studentId/guardians')
  findForStudent(@Param('studentId') studentId: string) {
    return this.guardians.findForStudent(studentId);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('students/:studentId/guardians')
  linkToStudent(@Param('studentId') studentId: string, @Body() body: LinkGuardianDto) {
    return this.guardians.linkToStudent(studentId, body);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Patch('student-guardians/:linkId')
  updateLink(@Param('linkId') linkId: string, @Body() body: UpdateGuardianLinkDto) {
    return this.guardians.updateLink(linkId, body);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Delete('student-guardians/:linkId')
  unlink(@Param('linkId') linkId: string) {
    return this.guardians.unlink(linkId);
  }
}
