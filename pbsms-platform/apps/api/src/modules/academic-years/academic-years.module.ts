import { Module } from '@nestjs/common';
import { AcademicYearsController } from './academic-years.controller';
import { AcademicYearsService } from './academic-years.service';

@Module({
  controllers: [AcademicYearsController],
  providers: [AcademicYearsService],
})
export class AcademicYearsModule {}
