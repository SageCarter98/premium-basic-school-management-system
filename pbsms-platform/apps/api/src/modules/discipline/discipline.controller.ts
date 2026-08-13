import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DisciplineService } from './discipline.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { AddNoteDto } from './dto/add-note.dto';
import { IssueResponseDto } from './dto/issue-response.dto';
import { ContactGuardianDto } from './dto/contact-guardian.dto';
import { FileAppealDto } from './dto/file-appeal.dto';
import { DecideAppealDto } from './dto/decide-appeal.dto';
import { CreateRecognitionDto } from './dto/create-recognition.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';

/** discipline.controller.ts — SRS Chapter 28 (FR-OPS-040). Reporting a
 * case, adding a note, and recognizing positive behaviour are things any
 * teacher does day to day (ACADEMIC_STAFF, matching real school
 * practice); investigating, issuing a formal response, closing/reopening
 * a case, contacting a guardian and deciding an appeal are a more senior
 * disciplinary-authority function (ACADEMIC_ADMIN). Chapter 3.2 has no
 * dedicated 'Discipline Officer' role, so this reuses the same academic
 * leadership tier grading/results does. */
@Controller('v1/discipline')
export class DisciplineController {
  constructor(private readonly discipline: DisciplineService) {}

  @Roles(...ACADEMIC_STAFF)
  @Post('cases')
  createCase(@Body() body: CreateCaseDto) {
    return this.discipline.createCase(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('cases')
  findAllCases() {
    return this.discipline.findAllCases();
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('cases/:id')
  findCase(@Param('id') id: string) {
    return this.discipline.findCase(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('cases/:id/start-investigation')
  startInvestigation(@Param('id') id: string) {
    return this.discipline.startInvestigation(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('cases/:id/responses')
  issueResponse(@Param('id') id: string, @Body() body: IssueResponseDto) {
    return this.discipline.issueResponse(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('cases/:id/responses')
  findResponses(@Param('id') id: string) {
    return this.discipline.findResponses(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('cases/:id/close')
  closeCase(@Param('id') id: string) {
    return this.discipline.closeCase(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('cases/:id/reopen')
  reopenCase(@Param('id') id: string) {
    return this.discipline.reopenCase(id);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('cases/:id/notes')
  addNote(@Param('id') id: string, @Body() body: AddNoteDto) {
    return this.discipline.addNote(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('cases/:id/notes')
  findNotes(@Param('id') id: string) {
    return this.discipline.findNotes(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('cases/:id/guardian-contacts')
  contactGuardian(@Param('id') id: string, @Body() body: ContactGuardianDto) {
    return this.discipline.contactGuardian(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('cases/:id/guardian-contacts')
  findGuardianContacts(@Param('id') id: string) {
    return this.discipline.findGuardianContacts(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('cases/:id/appeals')
  fileAppeal(@Param('id') id: string, @Body() body: FileAppealDto) {
    return this.discipline.fileAppeal(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('cases/:id/appeals')
  findAppeals(@Param('id') id: string) {
    return this.discipline.findAppeals(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('appeals/:id/decide')
  decideAppeal(@Param('id') id: string, @Body() body: DecideAppealDto) {
    return this.discipline.decideAppeal(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('recognitions')
  createRecognition(@Body() body: CreateRecognitionDto) {
    return this.discipline.createRecognition(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('recognitions')
  findAllRecognitions() {
    return this.discipline.findAllRecognitions();
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('recognitions/:id')
  findRecognition(@Param('id') id: string) {
    return this.discipline.findRecognition(id);
  }
}
