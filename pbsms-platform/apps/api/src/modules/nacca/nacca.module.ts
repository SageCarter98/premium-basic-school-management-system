import { Module } from '@nestjs/common';
import { NaccaController } from './nacca.controller';
import { NaccaService } from './nacca.service';

// Exported so parent-view.module.ts can compose competencyProfile() into
// the report card response server-side — the guardian access token
// Parent View runs under isn't authorized to call /v1/nacca/* directly
// (that path isn't in tenant.middleware.ts's PARENT_PATH_PREFIX branch),
// so this has to be composed on the backend, not fetched a second time
// from the frontend the way nacca.service.ts's own header otherwise
// expects a caller to compose it.
@Module({
  controllers: [NaccaController],
  providers: [NaccaService],
  exports: [NaccaService],
})
export class NaccaModule {}
