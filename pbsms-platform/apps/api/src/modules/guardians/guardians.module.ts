import { Module } from '@nestjs/common';
import { GuardiansController } from './guardians.controller';
import { GuardiansService } from './guardians.service';

/** GuardiansService is exported so other modules (discipline, health,
 * communication) can inject it to validate a polymorphic recipientType
 * === 'guardian' id — see guardians.service.ts's isRealGuardian() and
 * 0019_guardians.sql's header, mirroring StaffModule's identical role for
 * recipientType === 'staff'. */
@Module({
  controllers: [GuardiansController],
  providers: [GuardiansService],
  exports: [GuardiansService],
})
export class GuardiansModule {}
