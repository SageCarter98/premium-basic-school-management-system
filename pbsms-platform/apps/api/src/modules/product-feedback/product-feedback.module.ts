import { Module } from '@nestjs/common';
import { ProductFeedbackController } from './product-feedback.controller';
import { ProductFeedbackService } from './product-feedback.service';

@Module({
  controllers: [ProductFeedbackController],
  providers: [ProductFeedbackService],
})
export class ProductFeedbackModule {}
