import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AssessmentService } from './assessment.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { CreateAssessmentStructureDto } from './dto/create-assessment-structure.dto';
import { AddAssessmentComponentDto } from './dto/add-assessment-component.dto';
import { ReopenAssessmentStructureDto } from './dto/reopen-assessment-structure.dto';
import { UpsertScoreDto } from './dto/upsert-score.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';

/** assessment.controller.ts — SRS Chapter 19. Structural configuration
 * (subjects, structures, components, publish/reopen) is an
 * examination-office/academic-coordinator function (ACADEMIC_ADMIN);
 * score entry is where the actual class/subject teacher acts
 * (ACADEMIC_STAFF) — FR-ASM-020's teacher-assignment-scoped restriction
 * is enforced in assessment.service.ts's upsertScore() via
 * TeacherAssignmentsService.hasActiveAssignment() (0020_teacher_assignments.sql),
 * not just by role here. */
@Controller('v1/assessment')
export class AssessmentController {
  constructor(private readonly assessment: AssessmentService) {}

  @Roles(...ACADEMIC_ADMIN)
  @Post('subjects')
  createSubject(@Body() body: CreateSubjectDto) {
    return this.assessment.createSubject(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('subjects')
  findAllSubjects() {
    return this.assessment.findAllSubjects();
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('structures')
  createStructure(@Body() body: CreateAssessmentStructureDto) {
    return this.assessment.createStructure(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('structures')
  findAllStructures() {
    return this.assessment.findAllStructures();
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('structures/:id')
  findStructure(@Param('id') id: string) {
    return this.assessment.findStructure(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('structures/:id/components')
  addComponent(@Param('id') id: string, @Body() body: AddAssessmentComponentDto) {
    return this.assessment.addComponent(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('structures/:id/components')
  findComponents(@Param('id') id: string) {
    return this.assessment.findComponents(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('structures/:id/publish')
  publish(@Param('id') id: string) {
    return this.assessment.publish(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('structures/:id/reopen')
  reopen(@Param('id') id: string, @Body() body: ReopenAssessmentStructureDto) {
    return this.assessment.reopen(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Post('components/:id/scores')
  upsertScore(@Param('id') id: string, @Body() body: UpsertScoreDto) {
    return this.assessment.upsertScore(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('components/:id/scores')
  findScores(@Param('id') id: string) {
    return this.assessment.findScores(id);
  }
}
