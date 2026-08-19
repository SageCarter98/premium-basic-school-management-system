import { Module } from '@nestjs/common';
import { GuardiansModule } from '../guardians/guardians.module';
import { CommunicationModule } from '../communication/communication.module';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';

@Module({
  imports: [GuardiansModule, CommunicationModule],
  controllers: [TransportController],
  providers: [TransportService],
})
export class TransportModule {}
