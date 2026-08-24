import { Body, Controller, Post } from '@nestjs/common';
import { ProductFeedbackService } from './product-feedback.service';
import { SubmitProductFeedbackDto } from './dto/submit-product-feedback.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { ALL_STAFF } from '../../common/auth/role-groups';
import { TenantContextStore } from '../../common/tenant/tenant-context';

/** product-feedback.controller.ts — write-only, any authenticated staff
 * member (ALL_STAFF). No GET: nothing reads this back through the app
 * yet (see 0046_product_feedback.sql's header) — a reporter cannot see
 * their own past submissions or anyone else's, by design, since this
 * leaves the tenant entirely. */
@Controller('v1/product-feedback')
export class ProductFeedbackController {
  constructor(private readonly feedback: ProductFeedbackService) {}

  @Roles(...ALL_STAFF)
  @Post()
  submit(@Body() body: SubmitProductFeedbackDto) {
    const { tenantId, roles } = TenantContextStore.current();
    return this.feedback.submit(tenantId, roles, body);
  }
}
