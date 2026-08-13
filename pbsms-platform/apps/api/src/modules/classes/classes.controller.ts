import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ClassesService } from './classes.service';
import { CreateClassDto } from './dto/create-class.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ALL_STAFF, ACADEMIC_ADMIN } from '../../common/auth/role-groups';

/** classes.controller.ts — SRS Chapter 17 (academic structure). */
@Controller('v1/classes')
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Roles(...ALL_STAFF)
  @Get()
  findAll() {
    return this.classes.findAll();
  }

  @Roles(...ALL_STAFF)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.classes.findOne(id);
  }

  @Roles(...ACADEMIC_ADMIN)
  @Post()
  create(@Body() body: CreateClassDto) {
    return this.classes.create(body);
  }
}
