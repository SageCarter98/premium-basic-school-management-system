import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { GradingService } from './grading.service';
import { CreateGradingPolicyDto } from './dto/create-grading-policy.dto';
import { AddScaleItemDto } from './dto/add-scale-item.dto';
import { ComputeResultsDto } from './dto/compute-results.dto';
import { RankResultsDto } from './dto/rank-results.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';

/** grading.controller.ts — SRS Chapter 20. Grading-scale configuration and
 * computing/ranking results is an examination-office function
 * (ACADEMIC_ADMIN), not a classroom teacher's — teachers only need to
 * read the results (ACADEMIC_STAFF). */
@Controller('v1/grading')
export class GradingController {
  constructor(private readonly grading: GradingService) {}

  @Roles(...ACADEMIC_ADMIN)
  @Post('policies')
  createPolicy(@Body() body: CreateGradingPolicyDto) {
    return this.grading.createPolicy(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('policies')
  findAllPolicies() {
    return this.grading.findAllPolicies();
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('policies/:id')
  findPolicy(@Param('id') id: string) {
    return this.grading.findPolicy(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('policies/:id/scale-items')
  addScaleItem(@Param('id') id: string, @Body() body: AddScaleItemDto) {
    return this.grading.addScaleItem(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('policies/:id/scale-items')
  findScaleItems(@Param('id') id: string) {
    return this.grading.findScaleItems(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('policies/:id/activate')
  activatePolicy(@Param('id') id: string) {
    return this.grading.activatePolicy(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('policies/:id/retire')
  retirePolicy(@Param('id') id: string) {
    return this.grading.retirePolicy(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('structures/:id/compute')
  compute(@Param('id') id: string, @Body() body: ComputeResultsDto) {
    return this.grading.compute(id, body);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post('structures/:id/rank')
  rank(@Param('id') id: string, @Body() body: RankResultsDto) {
    return this.grading.rank(id, body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get('structures/:id/results')
  findResults(@Param('id') id: string) {
    return this.grading.findResults(id);
  }
}
