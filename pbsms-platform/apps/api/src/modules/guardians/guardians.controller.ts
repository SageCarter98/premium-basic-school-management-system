import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { GuardiansService } from './guardians.service';
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { LinkGuardianDto } from './dto/link-guardian.dto';
import { UpdateGuardianLinkDto } from './dto/update-guardian-link.dto';
import { CreateAccessGrantDto } from './dto/create-access-grant.dto';
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

  // ---------------------------------------------------------------------
  // Stage 6 (Parent View) access links — ACADEMIC_ADMIN only, same tier
  // as every other guardian-write action. The raw token is present in
  // createAccessGrant()'s response body exactly once; listAccessGrants()
  // never returns it (nor the hash) — see guardians.service.ts.
  // ---------------------------------------------------------------------

  @Roles(...ACADEMIC_ADMIN)
  @Post('guardians/:guardianId/access-links')
  createAccessGrant(@Param('guardianId') guardianId: string, @Body() body: CreateAccessGrantDto) {
    return this.guardians.createAccessGrant(guardianId, body.expiresInDays);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Get('guardians/:guardianId/access-links')
  listAccessGrants(@Param('guardianId') guardianId: string) {
    return this.guardians.listAccessGrants(guardianId);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('guardian-access-links/:id/revoke')
  revokeAccessGrant(@Param('id') id: string) {
    return this.guardians.revokeAccessGrant(id);
  }
}
