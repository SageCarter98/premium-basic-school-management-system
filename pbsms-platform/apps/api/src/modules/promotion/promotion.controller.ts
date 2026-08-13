import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PromotionService } from './promotion.service';
import { RecommendPromotionDto } from './dto/recommend-promotion.dto';
import { DecidePromotionDto } from './dto/decide-promotion.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ACADEMIC_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';

/** promotion.controller.ts — SRS Chapter 22.2. recommend()/decide()/
 * apply() are all ACADEMIC_ADMIN — an academic-year-end administrative
 * decision (FR-PRO-020), not something the SRS ties to a narrower
 * segregation-of-duties rule the way Finance's reversal/approval is. */
@Controller('v1/promotion')
export class PromotionController {
  constructor(private readonly promotion: PromotionService) {}

  @Roles(...ACADEMIC_ADMIN)
  @Post()
  recommend(@Body() body: RecommendPromotionDto) {
    return this.promotion.recommend(body);
  }

  @Roles(...ACADEMIC_STAFF)
  @Get()
  findAll() {
    return this.promotion.findAll();
  }

  @Roles(...ACADEMIC_STAFF)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.promotion.findOne(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/decide')
  decide(@Param('id') id: string, @Body() body: DecidePromotionDto) {
    return this.promotion.decide(id, body);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post(':id/apply')
  apply(@Param('id') id: string) {
    return this.promotion.apply(id);
  }
}
