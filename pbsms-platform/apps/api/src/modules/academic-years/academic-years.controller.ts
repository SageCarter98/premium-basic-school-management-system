import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AcademicYearsService } from './academic-years.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ALL_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';

/** academic-years.controller.ts — SRS Chapter 17 (academic structure). */
@Controller('v1/academic-years')
export class AcademicYearsController {
  constructor(private readonly academicYears: AcademicYearsService) {}

  @Roles(...ALL_STAFF)
  @Get()
  findAll() {
    return this.academicYears.findAll();
  }

  @Roles(...ALL_STAFF)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.academicYears.findOne(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post()
  create(@Body() body: CreateAcademicYearDto) {
    return this.academicYears.create(body);
  }
}
