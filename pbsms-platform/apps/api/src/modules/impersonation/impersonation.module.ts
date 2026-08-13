import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ImpersonationController } from './impersonation.controller';
import { ImpersonationService } from './impersonation.service';

/** Imports AuthModule for JwtService (mintToken() signs impersonation
 * tokens with the same secret/config login() uses) rather than a second
 * JwtModule.register() — one shared JWT configuration, not two to keep
 * in sync. */
@Module({
  imports: [AuthModule],
  controllers: [ImpersonationController],
  providers: [ImpersonationService],
})
export class ImpersonationModule {}
