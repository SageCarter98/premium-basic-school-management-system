import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { TenantApplicationsController } from './tenant-applications.controller';
import { TenantApplicationsService } from './tenant-applications.service';

@Module({
  imports: [TenantsModule],
  controllers: [TenantApplicationsController],
  providers: [TenantApplicationsService],
})
export class TenantApplicationsModule {}
